import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useEffect } from 'react'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { parseTokenAccountResp, TokenAccount } from '@raydium-io/raydium-sdk'

import { useAppStore } from '../store/appStore'

export default function useInitSdk() {
  const { publicKey, signAllTransactions } = useWallet()
  const { connection } = useConnection()
  const initRaydium = useAppStore((s) => s.initRaydium)
  const raydium = useAppStore((s) => s.raydium)

  useEffect(() => {
    // raydium sdk initialization can be done with connection only
    if (connection) {
      initRaydium({ owner: publicKey || undefined, connection, logRequests: true })
    }
  }, [initRaydium, connection])

  useEffect(() => {
    // if user connected wallet, update pubkey
    if (raydium) {
      raydium.setOwner(publicKey || undefined)
      // raydium.setSignAllTransactions(signAllTransactions)
      useAppStore.setState({ connected: !!publicKey })
    }
  }, [raydium, publicKey, signAllTransactions])

  useEffect(() => {
    async function ccc() {
      if (!connection || !publicKey) return
      const solAccountResp = await connection.getAccountInfo(publicKey)
      const tokenAccountResp = await connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID })
      const tokenAccountData = parseTokenAccountResp({
        solAccountResp,
        tokenAccountResp: tokenAccountResp as any,
      })

      const tokenAccountMap: Map<string, TokenAccount[]> = new Map()
      tokenAccountData.tokenAccounts.forEach((tokenAccount) => {
        const mintStr = tokenAccount.mint?.toBase58()
        if (!tokenAccountMap.has(mintStr)) {
          tokenAccountMap.set(mintStr, [tokenAccount])
          return
        }
        tokenAccountMap.get(mintStr)!.push(tokenAccount)
      })

      tokenAccountMap.forEach((tokenAccount) => {
        tokenAccount.sort((a, b) => (a.amount.lt(b.amount) ? 1 : -1))
      })

      if (raydium) {
        raydium.account.updateTokenAccount(tokenAccountData)
      }
      useAppStore.setState({ tokenAccounts: tokenAccountData.tokenAccounts })
    }
    ccc()
  }, [connection, publicKey, raydium])
}
