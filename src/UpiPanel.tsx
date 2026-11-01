import { useEffect, useRef, useState } from 'react'
import { formatMoney } from './currency'
import { request } from './api'

type Payment = { invoiceId: string; name: string; amount: number; url: string }
type Receipt = {
  id: string
  invoice_id: string
  reference: string
  amount: number
  received_at: string
  verified_by_email: string
}
export function UpiPanel({
  csrf,
  owner,
  currency,
  canRecord,
  onRefresh,
}: {
  csrf: string
  owner: boolean
  currency: string
  canRecord: boolean
  onRefresh: () => Promise<void>
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const retries = useRef(new Map<string, { body: string; key: string }>())
  useEffect(() => {
    let active = true
    if (currency === 'INR')
      request<{ receipts: Receipt[] }>('/payments/upi/receipts')
        .then((result) => {
          if (active) setReceipts(result.receipts)
        })
        .catch((error) => {
          if (active) setMessage(error.message)
        })
    return () => {
      active = false
    }
  }, [csrf, currency])
  return (
    <section className="panel">
      <h3>UPI invoice payments</h3>
      <p>
        Use your bank-approved merchant UPI ID. Confirm receipt in your bank
        before recording collection. Opening a payment app does not confirm
        payment.
      </p>
      {currency !== 'INR' ? (
        <p>
          This workspace uses {currency}. UPI requests require an INR workspace;
          existing amounts cannot be relabelled as rupees.
        </p>
      ) : (
        <>
          {owner && (
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                const values = Object.fromEntries(
                  new FormData(event.currentTarget),
                )
                setBusy(true)
                setMessage('')
                try {
                  await request('/payments/upi/settings', {
                    method: 'PUT',
                    headers: { 'X-CSRF-Token': csrf },
                    body: JSON.stringify(values),
                  })
                  setPayments([])
                  setMessage(
                    'Merchant UPI details saved. Generate fresh links after changing the payee.',
                  )
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Could not save UPI details.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label>
                Merchant UPI ID
                <input
                  name="vpa"
                  placeholder="merchant@bank"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Payee name
                <input name="name" required maxLength={100} />
              </label>
              <button disabled={busy}>Save UPI details</button>
            </form>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setMessage('')
              setPayments([])
              try {
                const result = await request<{ requests: Payment[] }>(
                  '/payments/upi/requests',
                )
                setPayments(result.requests)
                if (!result.requests.length) setMessage('No unpaid invoices.')
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Could not generate payment links.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Generate unpaid invoice links
          </button>
          {payments.map((payment) => (
            <div key={payment.invoiceId}>
              <span>
                {payment.name} · INR {payment.amount.toFixed(2)}{' '}
              </span>
              <a href={payment.url}>Open UPI app</a>{' '}
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(payment.url)
                    setMessage('Payment link copied.')
                  } catch {
                    setMessage('Copy the payment link from the field below.')
                  }
                }}
              >
                Copy link
              </button>
              <input
                aria-label={`UPI link for ${payment.name}`}
                readOnly
                value={payment.url}
              />
              {canRecord && (
                <form
                  aria-label={`Verify UPI receipt for ${payment.name}`}
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const values = Object.fromEntries(
                      new FormData(event.currentTarget),
                    )
                    const receivedAt = new Date(String(values.receivedAt))
                    if (!Number.isFinite(receivedAt.getTime())) {
                      setMessage('Enter a valid receipt date and time.')
                      return
                    }
                    const body = JSON.stringify({
                      invoiceId: payment.invoiceId,
                      amount: payment.amount,
                      reference: values.reference,
                      receivedAt: receivedAt.toISOString(),
                      verifiedInBank: values.verifiedInBank === 'on',
                    })
                    const previous = retries.current.get(payment.invoiceId)
                    const key =
                      previous?.body === body
                        ? previous.key
                        : crypto.randomUUID()
                    retries.current.set(payment.invoiceId, { body, key })
                    setBusy(true)
                    setMessage('')
                    try {
                      const result = await request<{ receipt: Receipt }>(
                        '/payments/upi/receipts',
                        {
                          method: 'POST',
                          headers: {
                            'X-CSRF-Token': csrf,
                            'Idempotency-Key': key,
                          },
                          body,
                        },
                      )
                      setReceipts((items) => [
                        result.receipt,
                        ...items.filter(
                          (item) => item.id !== result.receipt.id,
                        ),
                      ])
                      setPayments((items) =>
                        items.filter(
                          (item) => item.invoiceId !== payment.invoiceId,
                        ),
                      )
                      retries.current.delete(payment.invoiceId)
                      setMessage(
                        'Manually verified UPI receipt recorded and invoice collected.',
                      )
                      try {
                        await onRefresh()
                      } catch {
                        setMessage(
                          'Receipt saved. Refresh the workspace to see the updated invoice.',
                        )
                      }
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Could not record receipt.',
                      )
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <label>
                    Bank UPI reference / UTR
                    <input
                      name="reference"
                      required
                      minLength={6}
                      maxLength={64}
                      pattern="[a-zA-Z0-9]+"
                    />
                  </label>
                  <label>
                    Receipt date and time
                    <input name="receivedAt" type="datetime-local" required />
                  </label>
                  <label>
                    <input name="verifiedInBank" type="checkbox" required />I
                    verified the full INR {payment.amount.toFixed(2)} credit in
                    the merchant bank account.
                  </label>
                  <button disabled={busy}>Record verified UPI receipt</button>
                </form>
              )}
            </div>
          ))}
        </>
      )}
      {currency === 'INR' && receipts.length > 0 && (
        <div>
          <h4>Manually verified UPI receipts</h4>
          <table>
            <thead>
              <tr>
                <th>Bank reference</th>
                <th>Amount (INR)</th>
                <th>Received</th>
                <th>Verified by</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td>{receipt.reference}</td>
                  <td>{formatMoney(receipt.amount)}</td>
                  <td>{new Date(receipt.received_at).toLocaleString('en-IN')}</td>
                  <td>{receipt.verified_by_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
