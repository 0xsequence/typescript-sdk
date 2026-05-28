# Node Contract Deploy Example

This example signs in with an OMS wallet, compiles a small Solidity ERC-20 with
a public `mint(address,uint256)` function, and submits a Polygon Amoy
deployment transaction through a deployer contract.

The SDK wallet transaction API requires a `to` address, so this example uses the
ERC-2470 SingletonFactory rather than a direct EVM contract-creation transaction.
The factory uses CREATE2 at `0xce0042B868300000d44A59004Da54A005ffdcf9f`
and exposes:

```solidity
function deploy(bytes initCode, bytes32 salt) external returns (address payable createdContract);
```

The script computes the contract address from the factory address, `DEPLOY_SALT`,
and the encoded init code before sending the transaction. You can override the
factory with `DEPLOYER_ADDRESS`, but the default works for Polygon Amoy.

## Tooling Choice

Use `solc` for this example's contract compilation and `viem` for deployment
calldata encoding. This keeps the example small and Node-native. Hardhat or
Foundry would be better once this grows into a larger contract project with
tests, scripts, and multiple contracts.

## Run

From the repository root:

```bash
pnpm install
pnpm build
cp examples/node-contract-deploy-example/.env.example examples/node-contract-deploy-example/.env.local
# Fill OMS_PUBLISHABLE_KEY and OMS_PROJECT_ID in .env.local
pnpm dev:node-contract-deploy-example
```

The script prompts for token name, symbol, and decimals after login. The default
answers are `WalletKit Dollar`, `WKUSD`, and `6`.

Optionally set a deterministic CREATE2 salt:

```bash
DEPLOY_SALT=0x0000000000000000000000000000000000000000000000000000000000000001
```

Each deploy writes a timestamped text record under `artifacts/` with the token
metadata, computed contract address, transaction id, transaction hash, and
explorer links. Generated artifact files are ignored by git.
