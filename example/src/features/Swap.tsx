import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import OutlinedInput from '@mui/material/OutlinedInput'
import {
  Percent,
  // RouteInfo,
  // RouteType,
  TokenAmount,
  WSOLMint,
  USDCMint,
  USDTMint,
  TickUtils,
  solToWSol,
  JupTokenType,
} from '@raydium-io/raydium-sdk'
import debounce from 'lodash/debounce'
import { useEffect, useState } from 'react'
import { PublicKey } from '@solana/web3.js'

import { useAppStore } from '../store/appStore'
import Decimal from 'decimal.js'
import BN from 'bn.js'

export default function Swap() {
  const raydium = useAppStore((state) => state.raydium)
  const connected = useAppStore((state) => state.connected)
  const [inAmount, setInAmount] = useState<string>('')
  const [outAmount, setOutAmount] = useState<TokenAmount>()
  const [minOutAmount, setMinOutAmount] = useState<TokenAmount>()
  // const [routes, setRoutes] = useState<RouteInfo[]>([])
  // const [routeType, setRouteType] = useState<RouteType>('amm')
  const [loading, setLoading] = useState<boolean>(false)

  // ray mint: 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R
  // PublicKey.default => sdk will auto recognize it as sol token
  // const [inToken, outToken] = [
  //   '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  //   '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
  // ]
  // const [inToken, outToken] = ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', PublicKey.default.toBase58()]
  // const [inToken, outToken] = [PublicKey.default.toBase58(), '9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa']
  // const [inToken, outToken] = ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', PublicKey.default.toBase58()]

  const [inToken, outToken] = [PublicKey.default.toBase58(), '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R']

  useEffect(() => {
    async function calculateAmount() {
      if (!raydium) return
      console.log(123123, raydium)
      const r = raydium.liquidityV2.computePairAmount({
        poolInfo: {
          type: 'standard',
          programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
          id: 'G2b9TTsZAkE1DP5JJdz7jufvB1XUrhwDKjCtSHLcpGhV',
          lpMint: {
            chainId: 101,
            address: 'AvYDLwEyk66Ric9im8vNWDfRU5hGoErQTeQAVLvgA1Q2',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            logoURI: '',
            symbol: 'WBTC-USDC',
            name: 'WBTC-USDC',
            decimals: 8,
            tags: [],
            extensions: {},
          },
          marketId: '3BAKsQd3RuhZKES2DGysMhjBdwjZYKYmxRqnSMtZ4KSN',
          mintA: {
            chainId: 101,
            address: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            logoURI: 'https://img.raydium.io/icon/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh.png',
            symbol: 'WBTC',
            name: 'Wrapped BTC (Wormhole)',
            decimals: 8,
            tags: [],
            extensions: {
              coingeckoId: 'wrapped-btc-wormhole',
            },
          },
          mintB: {
            chainId: 101,
            address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            logoURI: 'https://img.raydium.io/icon/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.png',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            tags: ['hasFreeze'],
            extensions: {
              coingeckoId: 'usd-coin',
            },
          },
          mintAmountA: 51870 / 10 ** 8,
          mintAmountB: 13404921 / 10 ** 6,
          farmIds: [],
          price: 27966.50885674738,
          lpPrice: 3360.246673142419,
          lpAmount: 0.00829762,
          tvl: 27.88205,
          feeRate: 0.0025,
          openTime: 1676323035,
          rewardInfos: [],
          day: {
            volume: 0.344198,
            volumeQuote: 0.344198,
            volumeFee: 0.0008604950000000001,
            apr: 23358314.3162,
            feeApr: 23358314.3162,
            priceMin: 28564.14937759336,
            priceMax: 28564.14937759336,
            rewardApr: [],
          },
          week: {
            volume: 0.344491,
            volumeQuote: 0.344491,
            volumeFee: 0.0008612275,
            apr: 45457.6076,
            feeApr: 45457.6076,
            priceMin: 28564.14937759336,
            priceMax: 29300,
            rewardApr: [],
          },
          month: {
            volume: 1.2714150000000002,
            volumeQuote: 1.2714150000000002,
            volumeFee: 0.0031785375000000005,
            apr: 719017.1354,
            feeApr: 719017.1354,
            priceMin: 28564.14937759336,
            priceMax: 30200,
            rewardApr: [],
          },
          pooltype: ['OpenBookMarket'],
        },
        amount: new TokenAmount(raydium.mintToToken('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'), 1, false),
        anotherToken: raydium.mintToToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        slippage: new Percent(1, 100),
      })
      console.log(123123111, r.anotherAmount.toExact())
      // await raydium.token.load({ type: JupTokenType.ALL })
      // await raydium.ammV3.load()
      // await raydium.ammV3.fetchPoolAccountPosition()
      //3tD34VtprDSkYCnATtQLCiVgTkECU3d12KtjupeR6N2X

      // const { routes, poolsInfo, ticks } = await raydium.tradeV2.fetchPoolAndTickData({
      //   inputMint: WSOLMint,
      //   outputMint: USDTMint,
      // })

      // const poolData = await raydium.tradeV2.fetchPoolAndTickData({
      //   inputMint: inToken,
      //   outputMint: outToken,
      // })

      // const { routes, poolsInfo, ticks } = poolData
      // const { best } = await raydium.tradeV2.getAllRouteComputeAmountOut({
      //   directPath: routes.directPath,
      //   routePathDict: routes.routePathDict,
      //   simulateCache: poolsInfo,
      //   tickCache: ticks,
      //   inputTokenAmount: raydium.mintToTokenAmount({ mint: inToken, amount: '0.01' }),
      //   outputToken: raydium.mintToToken(outToken),
      //   slippage: new Percent(1, 100),
      //   chainTime: ((await raydium.chainTimeOffset()) + Date.now()) / 1000,
      // })

      // console.log(123123, best?.poolType, best?.routeType)
      // best?.poolKey.forEach((p) => console.log(12312311, 'poolKey', p.id.toString()))

      // const { execute, transactions } = await raydium.tradeV2.swap({
      //   swapInfo: best!,
      //   associatedOnly: true,
      //   checkTransaction: true,
      //   checkCreateATAOwner: false,
      // })

      // transactions.forEach((t) => {
      //   console.log(12312322, 'tx ins len:', t.instructions.length)
      //   t.instructions.forEach((i) => {
      //     console.log(123123333, i.programId.toBase58())
      //   })
      // })

      // execute()

      if (!inAmount) {
        setOutAmount(undefined)
        setMinOutAmount(undefined)
        return
      }
      setLoading(true)
      /**
       * call getAvailablePools is optional, if you want to choose swap route by self
       *
       * return pool options: { availablePools, best, routedPools }, default will choose routedPools
       */
      // const { routedPools } = await raydium!.trade.getAvailablePools({
      //   inputMint: inToken,
      //   outputMint: outToken,
      // })!

      // if (!inAmount) {
      //   setLoading(false)
      //   return
      // }

      // const {
      //   amountOut: _amountOut,
      //   minAmountOut,
      //   routes,
      //   routeType,
      // } = await raydium!.trade.getBestAmountOut({
      //   pools: routedPools, // optional, pass only if called getAvailablePools
      //   amountIn: raydium!.decimalAmount({ mint: inToken, amount: inAmount })!,
      //   inputToken: raydium!.mintToToken(inToken),
      //   outputToken: raydium!.mintToToken(outToken),
      //   slippage: new Percent(1, 100),
      // })!

      // setOutAmount(_amountOut)
      // setMinOutAmount(minAmountOut)
      // setRouteType(routeType)
      // setRoutes(routes)
      // setLoading(false)
    }

    const debounceCalculate = debounce(() => {
      calculateAmount()
    }, 500)

    if (connected) {
      debounceCalculate()
    }
    return () => debounceCalculate.cancel()
  }, [connected, inToken, outToken, inAmount, raydium])

  const handleClick = async () => {
    // const { signers, execute, extInfo } = await raydium!.trade.swap({
    //   routes,
    //   routeType,
    //   amountIn: raydium!.mintToTokenAmount({ mint: inToken, amount: inAmount })!,
    //   amountOut: minOutAmount!,
    //   fixedSide: 'in',
    // })
    // await execute()
    /**
     * if you don't care about route/out amount, you can just call directSwap to execute swap
     */
    // const { transaction, signers, execute, extInfo } = await raydium!.trade.directSwap({
    //   amountOut: raydium!.mintToTokenAmount({ mint: outToken, amount: '0' })!,
    //   amountIn: raydium!.mintToTokenAmount({ mint: inToken, amount: inAmount })!,
    //   fixedSide: 'in',
    //   slippage: new Percent(1, 100),
    // })
    // const txId = execute()
  }
  const [inTokenInfo, outTokenInfo] = [raydium?.token.tokenMap.get(inToken), raydium?.token.tokenMap.get(outToken)]

  return (
    <div>
      <Box sx={{ maxWidth: 300 }}>
        {inTokenInfo ? (
          <Grid container alignItems="center" my="20px">
            <Grid>
              <Avatar
                sx={{ mr: '10px' }}
                alt={inTokenInfo.symbol}
                src={inTokenInfo.logoURI}
                imgProps={{ loading: 'lazy' }}
              />
            </Grid>
            <Grid>{inTokenInfo.symbol}</Grid>
          </Grid>
        ) : null}
        <div>Amount In</div>
        <OutlinedInput
          type="number"
          value={inAmount}
          onChange={(e) => setInAmount(e.target.value)}
          // label="Amount In"
          // variant="outlined"
        />
        <Grid container alignItems="center" my="20px">
          {outTokenInfo ? (
            <>
              <Grid>
                <Avatar
                  sx={{ mr: '10px' }}
                  alt={outTokenInfo.symbol}
                  src={outTokenInfo.logoURI}
                  imgProps={{ loading: 'lazy' }}
                />
              </Grid>
              <Grid>{outTokenInfo.symbol}</Grid>
            </>
          ) : null}
        </Grid>
        <div>Amount Out</div>
        <OutlinedInput
          type="number"
          value={outAmount?.toSignificant() || ''}
          // label="Amount Out"
          // variant="outlined"
          startAdornment={loading ? <CircularProgress /> : undefined}
          disabled
        />
        <div>min amount out: {minOutAmount?.toSignificant()}</div>
      </Box>
      <Button variant="contained" sx={{ mt: '20px' }} onClick={handleClick}>
        Swap
      </Button>
    </div>
  )
}
