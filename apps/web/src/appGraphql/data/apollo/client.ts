import { ApolloClient, ApolloLink, from, Observable } from '@apollo/client'
import { setupSharedApolloCache } from 'uniswap/src/data/cache'

// HookSwap dedupe (2026-07): HookSwap runs NO Uniswap GraphQL backend. All app data
// is served by HookSwap's own REST data-api (data.hookswap.org) which the Terminal
// screens bind to directly. The upstream Apollo HttpLink pointed at Uniswap's hosted
// GraphQL (*.gateway.uniswap.org via config.awsApiEndpoint) and produced the
// CORS-blocked `beta.gateway.uniswap.org/v1/graphql` errors in the live console.
//
// Replace the network transport with a terminating link that fails every operation
// locally (no fetch is issued), so zero GraphQL traffic reaches uniswap.org. Any
// legacy component still issuing a GraphQL query resolves to its existing
// error/empty state (the same behavior as when the request was CORS-failing), and
// the Terminal is unaffected because it never used GraphQL.
const disabledGraphqlLink = new ApolloLink(
  () =>
    new Observable((observer) => {
      observer.error(new Error('GraphQL disabled: HookSwap serves data via data.hookswap.org REST'))
    }),
)

export const apolloClient = new ApolloClient({
  connectToDevTools: true,
  link: from([disabledGraphqlLink]),
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://hookswap.org',
  },
  cache: setupSharedApolloCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
})
