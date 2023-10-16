import {
  Raydium,
  RaydiumLoadParams,
  setLoggerLevel,
  LogLevel,
  JupTokenType,
  TokenAccount,
} from '@raydium-io/raydium-sdk'
import create from 'zustand'

interface AppState {
  raydium?: Raydium
  initialing: boolean
  initRaydium: (payload: RaydiumLoadParams) => Promise<void>
  farmLoaded: boolean
  connected: boolean
  tokenAccounts: TokenAccount[]
}

export const useAppStore = create<AppState>((set, get) => ({
  raydium: undefined,
  initialing: false,
  farmLoaded: false,
  connected: false,
  tokenAccounts: [],
  initRaydium: async (payload) => {
    if (get().initialing) return

    set(() => ({ initialing: true }))
    setLoggerLevel('Raydium_Liquidity', LogLevel.Error)
    setLoggerLevel('Raydium_route', LogLevel.Error)
    payload.jupTokenType = JupTokenType.Strict
    const raydium = await Raydium.load(payload)
    raydium.token.fetchTokenPrices()
    set(() => ({ raydium, initialing: false, farmLoaded: false }))
  },
  loadFarm: async () => {
    const raydium = get().raydium
    if (!raydium) return
    await raydium.farm.load()
    set(() => ({ farmLoaded: true }))
  },
}))
