import { parseAbi } from 'viem'

export const walletKitDollarAbi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function mint(address to, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
])
