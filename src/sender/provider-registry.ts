import { Region, SenderProvider } from "./types.js";

/**
 * One default per supported HTTP region; an absent region is rejected rather than redirected.
 * Audited 2026-10-09. README documents alternate datacenters and binary Iris coverage limits.
 */
export const PROVIDER_ENDPOINTS: Record<
  Exclude<SenderProvider, SenderProvider.Rpc>,
  Partial<Record<Region, string>>
> = {
  [SenderProvider.Astralane]: {
    [Region.Global]: "https://edge.astralane.io/irisb",
    [Region.Frankfurt]: "http://fr.gateway.astralane.io/irisb",
    [Region.Amsterdam]: "http://ams.gateway.astralane.io/irisb",
    [Region.NewYork]: "http://ny.gateway.astralane.io/irisb",
    [Region.Tokyo]: "http://jp.gateway.astralane.io/irisb",
    [Region.Singapore]: "http://sg.gateway.astralane.io/irisb",
    [Region.LosAngeles]: "http://la.gateway.astralane.io/irisb",
  },
  [SenderProvider.BlockRazor]: {
    [Region.Frankfurt]: "https://frankfurt.solana.blockrazor.io/sendTransaction",
    [Region.NewYork]: "https://newyork.solana.blockrazor.io/sendTransaction",
    [Region.Tokyo]: "https://tokyo.solana.blockrazor.io/sendTransaction",
    [Region.Amsterdam]: "http://amsterdam.solana.blockrazor.xyz:443/sendTransaction",
    [Region.London]: "http://london.solana.blockrazor.xyz:443/sendTransaction",
    [Region.Singapore]: "http://singapore.solana.blockrazor.xyz:443/sendTransaction",
    [Region.LosAngeles]: "http://losangeles.solana.blockrazor.xyz:443/sendTransaction",
    [Region.Toronto]: "http://toronto.solana.blockrazor.xyz:443/sendTransaction",
  },
  [SenderProvider.ZeroSlot]: {
    [Region.Frankfurt]: "https://de.0slot.trade",
    [Region.Amsterdam]: "https://ams.0slot.trade",
    [Region.NewYork]: "https://ny.0slot.trade",
    [Region.Tokyo]: "https://jp.0slot.trade",
    [Region.LosAngeles]: "https://la.0slot.trade",
  },
  [SenderProvider.NextBlock]: {
    [Region.Frankfurt]: "https://frankfurt.nextblock.io/api/v2/submit",
    [Region.Amsterdam]: "https://amsterdam.nextblock.io/api/v2/submit",
    [Region.NewYork]: "https://ny.nextblock.io/api/v2/submit",
    [Region.London]: "https://london.nextblock.io/api/v2/submit",
    [Region.Singapore]: "https://singapore.nextblock.io/api/v2/submit",
    [Region.Tokyo]: "https://tokyo.nextblock.io/api/v2/submit",
    [Region.SaltLakeCity]: "https://slc.nextblock.io/api/v2/submit",
    [Region.Dublin]: "https://dublin.nextblock.io/api/v2/submit",
    [Region.Vilnius]: "https://vilnius.nextblock.io/api/v2/submit",
  },
  [SenderProvider.Helius]: {
    [Region.Global]: "https://sender.helius-rpc.com/fast",
    [Region.Frankfurt]: "http://fra-sender.helius-rpc.com/fast",
    [Region.Amsterdam]: "http://ams-sender.helius-rpc.com/fast",
    [Region.NewYork]: "http://ewr-sender.helius-rpc.com/fast",
    [Region.London]: "http://lon-sender.helius-rpc.com/fast",
    [Region.Tokyo]: "http://tyo-sender.helius-rpc.com/fast",
    [Region.Singapore]: "http://sg-sender.helius-rpc.com/fast",
    [Region.SaltLakeCity]: "http://slc-sender.helius-rpc.com/fast",
  },
};
/**
 * Complete tip-recipient lists published by the sources below, checked 2026-10-09.
 * Regional lanes share a provider's list. These are submission recipients, not validators.
 * Recheck the official sources when updating; third-party clients may contain only a subset.
 */
export const PROVIDER_TIP_ACCOUNTS = {
  /** @see https://astralane.gitbook.io/docs/low-latency/endpoints-and-configs */
  [SenderProvider.Astralane]: [
    "astrazznxsGUhWShqgNtAdfrzP2G83DzcWVJDxwV9bF",
    "astra4uejePWneqNaJKuFFA8oonqCE1sqF6b45kDMZm",
    "astra9xWY93QyfG6yM8zwsKsRodscjQ2uU2HKNL5prk",
    "astraRVUuTHjpwEVvNBeQEgwYx9w9CFyfxjYoobCZhL",
    "astraEJ2fEj8Xmy6KLG7B3VfbKfsHXhHrNdCQx7iGJK",
    "astraubkDw81n4LuutzSQ8uzHCv4BhPVhfvTcYv8SKC",
    "astraZW5GLFefxNPAatceHhYjfA1ciq9gvfEg2S47xk",
    "astrawVNP4xDBKT7rAdxrLYiTSTdqtUr63fSMduivXK",
    "AstrA1ejL4UeXC2SBP4cpeEmtcFPZVLxx3XGKXyCW6to",
    "AsTra79FET4aCKWspPqeSFvjJNyp96SvAnrmyAxqg5b7",
    "AstrABAu8CBTyuPXpV4eSCJ5fePEPnxN8NqBaPKQ9fHR",
    "AsTRADtvb6tTmrsqULQ9Wji9PigDMjhfEMza6zkynEvV",
    "AsTRAEoyMofR3vUPpf9k68Gsfb6ymTZttEtsAbv8Bk4d",
    "AStrAJv2RN2hKCHxwUMtqmSxgdcNZbihCwc1mCSnG83W",
    "Astran35aiQUF57XZsmkWMtNCtXGLzs8upfiqXxth2bz",
    "AStRAnpi6kFrKypragExgeRoJ1QnKH7pbSjLAKQVWUum",
    "ASTRaoF93eYt73TYvwtsv6fMWHWbGmMUZfVZPo3CRU9C",
  ],
  /** @see https://docs.blockrazor.io/transaction-submission/transaction-sending/solana/send-transaction/request-example/js */
  [SenderProvider.BlockRazor]: [
    "FjmZZrFvhnqqb9ThCuMVnENaM3JGVuGWNyCAxRJcFpg9",
    "6No2i3aawzHsjtThw81iq1EXPJN6rh8eSJCLaYZfKDTG",
    "A9cWowVAiHe9pJfKAj3TJiN9VpbzMUq6E4kEvf5mUT22",
    "Gywj98ophM7GmkDdaWs4isqZnDdFCW7B46TXmKfvyqSm",
    "68Pwb4jS7eZATjDfhmTXgRJjCiZmw1L7Huy4HNpnxJ3o",
    "4ABhJh5rZPjv63RBJBuyWzBK3g9gWMUQdTZP2kiW31V9",
    "B2M4NG5eyZp5SBQrSdtemzk5TqVuaWGQnowGaCBt8GyM",
    "5jA59cXMKQqZAVdtopv8q3yyw9SYfiE3vUCbt7p8MfVf",
    "5YktoWygr1Bp9wiS1xtMtUki1PeYuuzuCF98tqwYxf61",
    "295Avbam4qGShBYK7E9H5Ldew4B3WyJGmgmXfiWdeeyV",
    "EDi4rSy2LZgKJX74mbLTFk4mxoTgT6F7HxxzG2HBAFyK",
    "BnGKHAC386n4Qmv9xtpBVbRaUTKixjBe3oagkPFKtoy6",
    "Dd7K2Fp7AtoN8xCghKDRmyqr5U169t48Tw5fEd3wT9mq",
    "AP6qExwrbRgBAVaehg4b5xHENX815sMabtBzUzVB4v8S",
  ],
  /** @see https://0slot.trade/docs.php */
  [SenderProvider.ZeroSlot]: [
    "6fQaVhYZA4w3MBSXjJ81Vf6W1EDYeUPXpgVQ6UQyU1Av",
    "4HiwLEP2Bzqj3hM2ENxJuzhcPCdsafwiet3oGkMkuQY4",
    "7toBU3inhmrARGngC7z6SjyP85HgGMmCTEwGNRAcYnEK",
    "8mR3wB1nh4D6J9RUCugxUpc6ya8w38LPxZ3ZjcBhgzws",
    "6SiVU5WEwqfFapRuYCndomztEwDjvS5xgtEof3PLEGm9",
    "TpdxgNJBWZRL8UXF5mrEsyWxDWx9HQexA9P1eTWQ42p",
    "D8f3WkQu6dCF33cZxuAsrKHrGsqGP2yvAHf8mX6RXnwf",
    "GQPFicsy3P3NXxB5piJohoxACqTvWE9fKpLgdsMduoHE",
    "Ey2JEr8hDkgN8qKJGrLf2yFjRhW7rab99HVxwi5rcvJE",
    "4iUgjMT8q2hNZnLuhpqZ1QtiV8deFPy2ajvvjEpKKgsS",
    "3Rz8uD83QsU8wKvZbgWAPvCNDU6Fy8TSZTMcPm3RB6zt",
    "DiTmWENJsHQdawVUUKnUXkconcpW4Jv52TnMWhkncF6t",
    "HRyRhQ86t3H4aAtgvHVpUJmw64BDrb61gRiKcdKUXs5c",
    "7y4whZmw388w1ggjToDLSBLv47drw5SUXcLk6jtmwixd",
    "J9BMEWFbCBEjtQ1fG5Lo9kouX1HfrKQxeUxetwXrifBw",
    "8U1JPQh3mVQ4F5jwRdFTBzvNRQaYFQppHQYoH38DJGSQ",
    "Eb2KpSC8uMt9GmzyAEm5Eb1AAAgTjRaXWFjKyFXHZxF3",
    "FCjUJZ1qozm1e8romw216qyfQMaaWKxWsuySnumVCCNe",
    "ENxTEjSQ1YabmUpXAdCgevnHQ9MHdLv8tzFiuiYJqa13",
    "6rYLG55Q9RpsPGvqdPNJs4z5WTxJVatMB8zV3WJhs5EK",
    "Cix2bHfqPcKcM233mzxbLk14kSggUUiz2A87fJtGivXr",
  ],
  /** @see https://docs.nextblock.io/getting-started/quickstart */
  [SenderProvider.NextBlock]: [
    "NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE",
    "NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2",
    "NeXTBLoCKs9F1y5PJS9CKrFNNLU1keHW71rfh7KgA1X",
    "NexTBLockJYZ7QD7p2byrUa6df8ndV2WSd8GkbWqfbb",
    "neXtBLock1LeC67jYd1QdAa32kbVeubsfPNTJC1V5At",
    "nEXTBLockYgngeRmRrjDV31mGSekVPqZoMGhQEZtPVG",
    "NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid",
    "nextBLoCkPMgmG8ZgJtABeScP35qLa2AMCNKntAP7Xc",
  ],
  /** @see https://www.helius.dev/docs/sending-transactions/sender-max */
  [SenderProvider.Helius]: [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
    "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
    "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
    "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
    "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
    "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
    "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
    "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
    "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
  ],
} as const satisfies Record<
  Exclude<SenderProvider, SenderProvider.Rpc>,
  readonly string[]
>;
