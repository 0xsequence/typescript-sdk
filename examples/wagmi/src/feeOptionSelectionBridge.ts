import type { FeeOptionSelection, FeeOptionWithBalance } from '@0xsequence/typescript-sdk'

export type FeeOptionSelectionRequest = {
  options: FeeOptionWithBalance[]
  resolve: (selection: FeeOptionSelection | undefined) => void
  reject: (error: Error) => void
}

type FeeOptionSelectionListener = (request: FeeOptionSelectionRequest) => void

let listener: FeeOptionSelectionListener | undefined
let rejectPendingSelection: ((error: Error) => void) | undefined

export function subscribeToFeeOptionSelection(nextListener: FeeOptionSelectionListener): () => void {
  listener = nextListener

  return () => {
    if (listener === nextListener) {
      listener = undefined
    }
    rejectPendingSelection?.(new Error('Fee option selection cancelled.'))
    rejectPendingSelection = undefined
  }
}

export async function selectFeeOptionWithAppUi(options: FeeOptionWithBalance[]): Promise<FeeOptionSelection | undefined> {
  if (!listener) {
    const payableOption = options.find(canPayFeeOption)
    if (!payableOption) {
      throw new Error('No fee option has enough balance.')
    }
    return { token: payableOption.feeOption.token.symbol }
  }

  rejectPendingSelection?.(new Error('Fee option selection was superseded.'))

  return new Promise((resolve, reject) => {
    rejectPendingSelection = reject
    listener?.({
      options,
      resolve: (selection) => {
        rejectPendingSelection = undefined
        resolve(selection)
      },
      reject: (error) => {
        rejectPendingSelection = undefined
        reject(error)
      },
    })
  })
}

function canPayFeeOption(option: FeeOptionWithBalance): boolean {
  if (option.availableRaw === undefined) return false

  try {
    return BigInt(option.availableRaw) >= BigInt(option.feeOption.value)
  } catch {
    return false
  }
}
