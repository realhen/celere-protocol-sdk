import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const denyNetwork = () => {
  throw new Error("Packed native instruction consumer attempted network access");
};
globalThis.fetch = denyNetwork;
globalThis.WebSocket = class {
  constructor() {
    denyNetwork();
  }
};

const { entrypoints, cases } = JSON.parse(
  await readFile(new URL("./native-instructions.json", import.meta.url), "utf8"),
  (_, value) => {
    if (value && typeof value === "object") {
      if ("bigint" in value) return BigInt(value.bigint);
      if ("bytes" in value) return Uint8Array.from(value.bytes);
    }
    return value;
  },
);

let builderCount = 0;
for (const entrypoint of entrypoints) {
  const exports = await import(`celere-protocol-sdk/${entrypoint}`);
  const builders = Object.entries(exports).filter(([name]) =>
    /^get.+Instruction$/.test(name),
  );
  assert.ok(builders.length > 0, `${entrypoint} has no native builders`);
  for (const [, builder] of builders) assert.equal(typeof builder, "function");
  builderCount += builders.length;
}

const { compileTransaction } = await import("celere-protocol-sdk/transactions");
const {
  getRaydiumCpmmSwapBaseInputInstruction,
  getRaydiumCpmmSwapBaseOutputInstruction,
} = await import("celere-protocol-sdk/instructions/raydium-cpmm");

for (const scenario of cases) {
  const instruction =
    scenario.kind === "exactIn"
      ? getRaydiumCpmmSwapBaseInputInstruction(scenario.accounts, scenario.args)
      : getRaydiumCpmmSwapBaseOutputInstruction(scenario.accounts, scenario.args);
  assert.deepEqual(instruction, scenario.expectedInstruction);
  const transaction = compileTransaction({
    instructions: [instruction],
    feePayer: scenario.accounts.owner,
    lifetime: scenario.lifetime,
  });
  assert.equal(transaction.ok, true);
  assert.deepEqual(transaction.value.wireBytes, scenario.expectedWireBytes);
  assert.deepEqual(transaction.value.requiredSigners, [scenario.accounts.owner]);
  assert.ok(
    Object.values(transaction.value.transaction.signatures).every(
      (signature) => signature === null,
    ),
  );
}

for (const amountIn of [-1n, 1n << 64n]) {
  assert.throws(() =>
    getRaydiumCpmmSwapBaseInputInstruction(cases[0].accounts, {
      amountIn,
      minimumAmountOut: 0n,
    }),
  );
}
console.log(
  JSON.stringify({ entrypoints: entrypoints.length, builderCount, cases: cases.length }),
);
