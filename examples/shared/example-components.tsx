import type {
  FeeOptionWithBalance,
  OMSWalletSessionExpiredEvent,
  WalletAccount,
  PendingWalletSelection
} from '@polygonlabs/oms-wallet';
import {
  canAffordFeeOption,
  formatSessionAuth,
  formatOidcProvider,
  formatWalletType,
  type OidcRedirectProvider
} from './example-utils';

export function SessionOptions({
  useManualWalletSelection,
  sessionLifetimeSeconds,
  disabled,
  onManualWalletSelectionChange,
  onSessionLifetimeChange
}: {
  useManualWalletSelection: boolean;
  sessionLifetimeSeconds: number;
  disabled: boolean;
  onManualWalletSelectionChange: (value: boolean) => void;
  onSessionLifetimeChange: (value: string) => void;
}) {
  return (
    <div className="header-options">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={useManualWalletSelection}
          onChange={(event) => onManualWalletSelectionChange(event.target.checked)}
          disabled={disabled}
        />
        <span>Use manual wallet selection</span>
      </label>
      <label className="session-lifetime-option">
        <span className="session-lifetime-copy">
          <strong>Session lifetime</strong>
          <small>Shorten this to test session expiry easier.</small>
        </span>
        <span>
          <input
            type="number"
            min={1}
            step={1}
            value={sessionLifetimeSeconds}
            onChange={(event) => onSessionLifetimeChange(event.target.value)}
            disabled={disabled}
          />
          <small>seconds</small>
        </span>
      </label>
    </div>
  );
}

export function OidcButtons({
  providers,
  disabled,
  status,
  statusId = 'redirect-status',
  buttonClassName = 'secondary',
  onStart
}: {
  providers: OidcRedirectProvider[];
  disabled: boolean;
  status?: string;
  statusId?: string;
  buttonClassName?: string;
  onStart: (provider: OidcRedirectProvider) => void;
}) {
  if (providers.length === 0) return null;

  return (
    <div className="field-stack">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          className={buttonClassName}
          onClick={() => onStart(provider)}
          disabled={disabled}
          aria-describedby={statusId}
        >
          Continue with {formatOidcProvider(provider)}
        </button>
      ))}
      {status ? (
        <p id={statusId} className="field-hint">
          {status}
        </p>
      ) : null}
    </div>
  );
}

export function EmailLoginForm({
  email,
  disabled,
  status,
  onEmailChange,
  onSubmit
}: {
  email: string;
  disabled: boolean;
  status?: string;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field-stack">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="user@example.com"
            aria-describedby={status !== undefined ? 'email-status' : undefined}
            autoComplete="email"
            autoCapitalize="none"
            disabled={disabled}
            spellCheck={false}
          />
        </label>
        {status !== undefined ? (
          <p id="email-status" className="field-hint">
            {status}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={disabled || !email.trim()}>
        Send code
      </button>
    </form>
  );
}

export function EmailCodeForm({
  code,
  disabled,
  status,
  onCodeChange,
  onSubmit,
  onBack
}: {
  code: string;
  disabled: boolean;
  status?: string;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field-stack">
        <label>
          Code
          <input
            autoFocus
            inputMode="numeric"
            type="text"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            pattern="[0-9]*"
            placeholder="123456"
            autoComplete="one-time-code"
            aria-describedby={status !== undefined ? 'code-status' : undefined}
            disabled={disabled}
          />
        </label>
        {status !== undefined ? (
          <p id="code-status" className="field-hint">
            {status}
          </p>
        ) : null}
      </div>
      <div className="actions">
        <button type="submit" disabled={disabled || !code.trim()}>
          Complete sign-in
        </button>
        <button type="button" className="secondary" onClick={onBack} disabled={disabled}>
          Back
        </button>
      </div>
    </form>
  );
}

export function WalletSelectionPanel({
  pendingWalletSelection,
  authStatus,
  disabled,
  onSelectWallet,
  onCreateWallet,
  onCancel
}: {
  pendingWalletSelection: PendingWalletSelection;
  authStatus?: string;
  disabled: boolean;
  onSelectWallet: (wallet: WalletAccount) => void;
  onCreateWallet: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stack">
      <section className="tool wallet-selection">
        <div className="tool-header">
          <h2>Choose wallet</h2>
          <span className="metadata-pill">
            {formatWalletType(pendingWalletSelection.walletType)}
          </span>
        </div>
        <h3>Existing wallets</h3>
        {pendingWalletSelection.wallets.length > 0 ? (
          <div className="wallet-option-list">
            {pendingWalletSelection.wallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                className="wallet-option"
                onClick={() => onSelectWallet(wallet)}
                disabled={disabled}
              >
                <span>
                  <strong>{wallet.reference ?? `${formatWalletType(wallet.type)} wallet`}</strong>
                  <small>{wallet.id}</small>
                </span>
                <code>{wallet.address}</code>
                <span className="wallet-option-action">Use wallet</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="field-hint">
            No existing {formatWalletType(pendingWalletSelection.walletType)} wallets.
          </p>
        )}

        <h3>Create new wallet</h3>
        <button type="button" onClick={onCreateWallet} disabled={disabled}>
          Create wallet
        </button>

        <button type="button" className="secondary subtle" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </section>
      {authStatus ? <output>{authStatus}</output> : null}
    </div>
  );
}

export function FeeOptionsPanel({
  feeOptions,
  panelClassName = 'fee-options',
  allowUnknownBalance = false,
  onCancel,
  onChoose
}: {
  feeOptions: FeeOptionWithBalance[];
  panelClassName?: string;
  allowUnknownBalance?: boolean;
  onCancel: () => void;
  onChoose: (option: FeeOptionWithBalance) => void;
}) {
  return (
    <div className="fee-modal-backdrop">
      <section
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fee-options-title"
      >
        <h2 id="fee-options-title">Fee option</h2>
        <div className="fee-option-list">
          {feeOptions.map((option) => {
            const canAfford =
              (allowUnknownBalance && option.availableRaw === undefined) ||
              canAffordFeeOption(option);

            return (
              <button
                key={`${option.feeOption.token.symbol}-${option.feeOption.value}`}
                type="button"
                className="fee-option"
                onClick={() => onChoose(option)}
                disabled={!canAfford}
              >
                <span>
                  <strong>{option.feeOption.token.symbol}</strong>
                  <small>{option.feeOption.displayValue || option.feeOption.value}</small>
                </span>
                <span>
                  {canAfford ? (option.available ?? 'Balance unavailable') : 'Insufficient balance'}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel transaction
        </button>
      </section>
    </div>
  );
}

export function SessionExpiredDialog({
  event,
  disabled,
  onReauthenticate,
  onDismiss
}: {
  event: OMSWalletSessionExpiredEvent;
  disabled: boolean;
  onReauthenticate: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
      >
        <h2 id="session-expired-title">Session expired</h2>
        <p>Your wallet session has expired. Reauthenticate to continue using this wallet.</p>
        {event.session.auth?.email && (
          <p className="modal-detail">
            Account <strong>{event.session.auth.email}</strong>
          </p>
        )}
        <p className="modal-hint">
          {event.session.auth?.type === 'oidc'
            ? `You will be redirected to ${formatSessionAuth(event.session.auth)}.`
            : event.session.auth?.type === 'email' && event.session.auth.email
              ? 'A new sign-in code will be sent to the same email address.'
              : 'Sign in again to continue.'}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onReauthenticate} disabled={disabled}>
            Reauthenticate
          </button>
          <button type="button" className="secondary" onClick={onDismiss} disabled={disabled}>
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
