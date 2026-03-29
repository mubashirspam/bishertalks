# Razorpay Test Mode Guide

## Test Card Details for Testing

### ✅ Successful Payment Test Cards

**Domestic Cards (India):**
- **Card Number:** `4111 1111 1111 1111`
- **CVV:** Any 3 digits (e.g., `123`)
- **Expiry:** Any future date (e.g., `12/25`)
- **Name:** Any name

**Alternative Success Cards:**
- `5555 5555 5555 4444` (Mastercard)
- `3782 822463 10005` (American Express)

### ❌ Failed Payment Test Cards

**Card Number:** `4000 0000 0000 0002`
- **CVV:** Any 3 digits
- **Expiry:** Any future date
- This card will simulate a payment failure

### 🔄 Other Test Scenarios

**Insufficient Funds:**
- **Card Number:** `4000 0000 0000 9995`

**Card Declined:**
- **Card Number:** `4000 0000 0000 0069`

## UPI Test Mode

In Razorpay Test Mode, UPI payments work differently:

1. **Test UPI ID:** Use any UPI ID format (e.g., `test@paytm`)
2. **Auto-Success:** In test mode, UPI payments auto-succeed after you click "Pay"
3. **No Real UPI App:** You won't be redirected to a real UPI app

## Testing Steps

### 1. Check Environment Variables

Make sure your `.env.local` has TEST keys:

```bash
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_test_secret_key
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Test Payment Flow

1. Go to `/neuro-code/checkout`
2. Fill in the form with test data:
   - **Name:** Test User
   - **Phone:** 9876543210
   - **Email:** test@example.com
   - **Address:** Test Address
   - **City:** Mumbai
   - **State:** Maharashtra
   - **Pincode:** 400001

3. Click "Pay ₹499"
4. Razorpay checkout should open with:
   - ✅ UPI option
   - ✅ Cards option
   - ✅ Netbanking option
   - ✅ Wallets option

### 3. Test Card Payment

1. Select **Cards** tab
2. Enter test card: `4111 1111 1111 1111`
3. CVV: `123`
4. Expiry: `12/25`
5. Click **Pay**
6. Should redirect to thank you page

### 4. Test UPI Payment

1. Select **UPI** tab
2. Enter any UPI ID: `test@paytm`
3. Click **Pay**
4. In test mode, it will auto-succeed

### 5. Test Failed Payment

1. Use card: `4000 0000 0000 0002`
2. Payment should fail
3. Check order status in admin panel

## Troubleshooting

### UPI Not Showing?

**Fixed!** The code now includes:
```javascript
method: {
  upi: true,
  card: true,
  netbanking: true,
  wallet: true,
}
```

### Payment Verification Failing?

Check browser console and server logs for:
```
[Verify] Payment verification request: {...}
[Verify] Signature verified successfully
```

If you see signature mismatch, ensure:
- Test keys match in Razorpay dashboard
- Using correct `RAZORPAY_KEY_SECRET`

### Test vs Live Mode

**Current Setup:** Test Mode ✅
- Safe to test all functions
- No real money involved
- Can test failures without issues

**Before Going Live:**
1. Get Live API keys from Razorpay
2. Complete KYC verification
3. Update `.env.local` with live keys
4. Test with small real amount first
5. Enable webhooks for production URL

## Webhook Testing (Optional)

For local testing of webhooks:

1. Install ngrok: `npm install -g ngrok`
2. Run: `ngrok http 3000`
3. Copy the HTTPS URL
4. Add webhook in Razorpay Dashboard:
   - URL: `https://your-ngrok-url.ngrok.io/api/webhook/razorpay`
   - Events: `payment.captured`, `payment.failed`
5. Copy webhook secret to `.env.local`

## Admin Panel Testing

1. Login: `/admin/login`
2. View orders: `/admin/orders`
3. Check payment status updates
4. Verify order details

## Common Test Scenarios

### ✅ Successful Flow
1. User fills form → Creates order
2. Razorpay opens → User pays with test card
3. Payment succeeds → Webhook updates status
4. User sees thank you page
5. Admin sees "paid" status

### ❌ Failed Flow
1. User fills form → Creates order
2. Razorpay opens → User uses failed card
3. Payment fails → Status remains "pending"
4. User can retry payment
5. Admin sees "failed" status

### 🔄 Cancelled Flow
1. User fills form → Creates order
2. Razorpay opens → User closes modal
3. Order remains "pending"
4. User can retry from order tracking page

## Next Steps

Once testing is complete:

1. ✅ Test all payment methods (UPI, Cards, Netbanking)
2. ✅ Test success and failure scenarios
3. ✅ Verify webhook updates work
4. ✅ Check WhatsApp notifications (if configured)
5. 🚀 Switch to Live mode when ready

## Support

If issues persist:
- Check browser console for errors
- Check server logs: `npm run dev`
- Verify all env variables are set
- Check Razorpay dashboard for test payments
