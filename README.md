# Raydium SDK

[npm-image]: https://img.shields.io/npm/v/@raydium-io/raydium-sdk-v2.svg?style=flat
[npm-url]: https://www.npmjs.com/package/@raydium-io/raydium-sdk-v2

[![npm][npm-image]][npm-url]

An SDK for building applications on top of Raydium.

## Usage Guide

### Installation

```
$ yarn add @raydium-io/raydium-sdk-v2
```

## SDK method Demo

[SDK V2 Demo Repo](https://github.com/raydium-io/raydium-sdk-V2-demo)

## Features

### Initialization

```
import { Raydium } from '@raydium-io/raydium-sdk'
const raydium = await Raydium.load({
  connection,
  owner, // key pair or publicKey, if you run a node process, provide keyPair
  signAllTransactions, // optional - provide sign functions provided by @solana/wallet-adapter-react
  tokenAccounts, // optional, if dapp handle it by self can provide to sdk
  tokenAccountRowInfos, // optional, if dapp handle it by self can provide to sdk
  disableLoadToken: false // default is false, if you don't need token info, set to true
})
```

#### how to transform token account data

```
import { parseTokenAccountResp } from '@raydium-io/raydium-sdk'

const solAccountResp = await connection.getAccountInfo(owner.publicKey)
const tokenAccountResp = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_PROGRAM_ID })
const token2022Req = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_2022_PROGRAM_ID })
const tokenAccountData = parseTokenAccountResp({
  owner: owner.publicKey,
  solAccountResp,
  tokenAccountResp: {
    context: tokenAccountResp.context,
    value: [...tokenAccountResp.value, ...token2022Req.value],
  },
})
```

#### how to get pool info

```
import { Api, PoolFetchType } from '@raydium-io/raydium-sdk-v2'

const api = new Api(connection);
const poolList = await api.fetchPoolByMints({
    mint1: 'So11111111111111111111111111111111111111112', // required
    mint2: 'any other mint or don't use this arg', // optional
    type: PoolFetchType.All, // optional
    sort: 'liquidity', // optional
    order: 'desc', // optional
    page: 1, // optional
});
```

#### data after initialization

```
# token
raydium.token.tokenList
raydium.token.tokenMap
raydium.token.mintGroup


# token account
raydium.account.tokenAccounts
raydium.account.tokenAccountRawInfos
```
