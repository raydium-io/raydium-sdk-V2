import { PublicKey, Transaction, Keypair } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'

export const pool = {
  type: 'Concentrated',
  programId: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  id: 'SR3fPdc6eJfvCneTXq8sv5NkGzr8QQZskBgUdceG46p',
  mintA: {
    chainId: 101,
    address: '4QN37F9hW9foFMDZy1aTZ8zMoT2DtrvGceVxdWg9EuFd',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    logoURI: '',
    symbol: '',
    name: '',
    decimals: 2,
    tags: [],
    extensions: {},
  },
  mintB: {
    chainId: 101,
    address: '9YBvSJsN4nMiJxNuxa6kADF9BDes8WF5DFVHtwcwquHS',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    logoURI: '',
    symbol: '',
    name: '',
    decimals: 3,
    tags: [],
    extensions: {},
  },
  rewardDefaultInfos: [],
  price: 0.1,
  mintAmountA: 0.01,
  mintAmountB: 0.001,
  tvl: 0,
  openTime: 0,
  feeRate: 0.0005,
  config: {
    id: 'HfERMT5DRA6C1TAqecrJQFpmkf3wsWTMncqnj3RDg5aw',
    index: 2,
    protocolFeeRate: 120000,
    tradeFeeRate: 500,
    tickSpacing: 10,
    fundFeeRate: 40000,
    description: 'Best for stable pairs',
    defaultRange: 0.1,
    defaultRangePoint: [0.01, 0.05, 0.1, 0.2, 0.5],
  },
  day: {
    volume: 0,
    volumeQuote: 0,
    volumeFee: 0,
    apr: 0,
    feeApr: 0,
    priceMin: 0,
    priceMax: 0,
    rewardApr: [],
  },
  week: {
    volume: 0,
    volumeQuote: 0,
    volumeFee: 0,
    apr: 0,
    feeApr: 0,
    priceMin: 0,
    priceMax: 0,
    rewardApr: [],
  },
  month: {
    volume: 0,
    volumeQuote: 0,
    volumeFee: 0,
    apr: 0,
    feeApr: 0,
    priceMin: 0,
    priceMax: 0,
    rewardApr: [],
  },
  pooltype: [],
  farmUpcomingCount: 0,
  farmOngoingCount: 0,
  farmFinishedCount: 0,
}

export const rewards = [
  {
    mint: {
      chainId: 101,
      address: 'So11111111111111111111111111111111111111112',
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      decimals: 9,
      symbol: 'WSOL',
      name: 'Wrapped SOL',
      logoURI: 'https://img.raydium.io/icon/So11111111111111111111111111111111111111112.png',
      tags: [],
      priority: 2,
      type: 'raydium',
      extensions: {
        coingeckoId: 'solana',
      },
    },
    openTime: 1699606920,
    endTime: 1700211720,
    perSecond: '1653.43915343915343915344',
  },
]

export const position = {
  bump: 252,
  nftMint: new PublicKey('DxJHQLdJqUAzfSRRJLXrtLjJxFdbqHeQciC4ZFpQRjGX'),
  poolId: new PublicKey('Enfoa5Xdtirwa46xxa5LUVcQWe7EUb2pGzTjfvU7EBS1'),
  tickLower: -21120,
  tickUpper: -19080,
  liquidity: new BN('507631955'),
  feeGrowthInsideLastX64A: new BN('116579978490887900'),
  feeGrowthInsideLastX64B: new BN('15878802686810160'),
  tokenFeesOwedA: new BN('0'),
  tokenFeesOwedB: new BN('0'),
  rewardInfos: [],
}

export const farm = {
  programId: 'EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q',
  id: 'HUDr9BDaAGqi37xbQHzxCyXvfMCKPTPNF8g9c9bPu1Fu',
  symbolMints: [
    {
      chainId: 101,
      address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      logoURI: 'https://img.raydium.io/icon/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R.png',
      symbol: 'RAY',
      name: 'Raydium',
      decimals: 6,
      tags: [],
      extensions: {
        coingeckoId: 'raydium',
      },
    },
    {
      chainId: 101,
      address: 'So11111111111111111111111111111111111111112',
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      logoURI: 'https://img.raydium.io/icon/So11111111111111111111111111111111111111112.png',
      symbol: 'SOL',
      name: 'Wrapped Solana',
      decimals: 9,
      tags: [],
      extensions: {
        coingeckoId: 'wrapped-solana',
      },
    },
  ],
  lpMint: {
    chainId: 101,
    address: '89ZKE4aoyfLBe2RuV6jM3JGNhaV18Nxh8eNtjRcndBip',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    logoURI: '',
    symbol: 'RAY-SOL',
    name: 'Raydium LP Token V4 (RAY-SOL)',
    decimals: 6,
    tags: [],
    extensions: {},
  },
  tvl: 1503376.3558951588,
  lpPrice: 1.3721224589286634,
  apr: 0.04478728878475776,
  tags: ['Farm'],
  rewardInfos: [
    {
      mint: {
        chainId: 101,
        address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        logoURI: 'https://img.raydium.io/icon/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R.png',
        symbol: 'RAY',
        name: 'Raydium',
        decimals: 6,
        tags: [],
        extensions: {
          coingeckoId: 'raydium',
        },
      },
      type: 'Standard SPL',
      perSecond: 13197.5,
      apr: 0.04478728878475776,
    },
  ],
  farmName: 'RAY/SOL',
  isOngoing: true,
  type: 'Raydium',
  version: 3,
}

export function printSimulate(transaction: Transaction) {
  if (!transaction.recentBlockhash) transaction.recentBlockhash = TOKEN_PROGRAM_ID.toBase58()
  if (!transaction.feePayer) transaction.feePayer = Keypair.generate().publicKey
  console.log('123123 simulate tx string:', transaction.serialize({ verifySignatures: false }).toString('base64'))
}
