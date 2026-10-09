import { Region, SenderProvider } from "./types.js";

/** Supported endpoint/region pairs; an absent region is rejected rather than redirected. */
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
// Provider-published recipients; provenance and validation status are documented in README.
export const PROVIDER_TIP_ACCOUNTS = {
  [SenderProvider.Astralane]: [
    "astrazznxsGUhWShqgNtAdfrzP2G83DzcWVJDxwV9bF",
    "astra4uejePWneqNaJKuFFA8oonqCE1sqF6b45kDMZm",
  ],
  [SenderProvider.BlockRazor]: [
    "FjmZZrFvhnqqb9ThCuMVnENaM3JGVuGWNyCAxRJcFpg9",
    "6No2i3aawzHsjtThw81iq1EXPJN6rh8eSJCLaYZfKDTG",
  ],
  [SenderProvider.ZeroSlot]: [
    "6fQaVhYZA4w3MBSXjJ81Vf6W1EDYeUPXpgVQ6UQyU1Av",
    "4HiwLEP2Bzqj3hM2ENxJuzhcPCdsafwiet3oGkMkuQY4",
  ],
  [SenderProvider.NextBlock]: [
    "NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE",
    "NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2",
  ],
  [SenderProvider.Helius]: [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  ],
};
