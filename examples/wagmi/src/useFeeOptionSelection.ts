import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeeOptionSelection, FeeOptionWithBalance } from '@0xsequence/typescript-sdk'
import { subscribeToFeeOptionSelection } from './feeOptionSelectionBridge'

type PendingFeeSelection = {
  resolve: (selection: FeeOptionSelection | undefined) => void
  reject: (error: Error) => void
}

export function useFeeOptionSelection(onRequest?: (options: FeeOptionWithBalance[]) => void) {
  const onRequestRef = useRef(onRequest)
  const pendingSelection = useRef<PendingFeeSelection | null>(null)
  const [feeOptions, setFeeOptions] = useState<FeeOptionWithBalance[]>([])

  useEffect(() => {
    onRequestRef.current = onRequest
  }, [onRequest])

  useEffect(() => subscribeToFeeOptionSelection((request) => {
    pendingSelection.current = {
      resolve: request.resolve,
      reject: request.reject,
    }
    setFeeOptions(request.options)
    onRequestRef.current?.(request.options)
  }), [])

  const resolveFeeOption = useCallback((selection: FeeOptionSelection | undefined) => {
    pendingSelection.current?.resolve(selection)
    pendingSelection.current = null
    setFeeOptions([])
  }, [])

  const rejectFeeOption = useCallback((error: Error) => {
    pendingSelection.current?.reject(error)
    pendingSelection.current = null
    setFeeOptions([])
  }, [])

  const clearFeeOptions = useCallback(() => {
    pendingSelection.current?.reject(new Error('Fee option selection cancelled.'))
    pendingSelection.current = null
    setFeeOptions([])
  }, [])

  return {
    feeOptions,
    resolveFeeOption,
    rejectFeeOption,
    clearFeeOptions,
  }
}
