"""
Webhook router — Stripe event handler.
Separate from auth router because Stripe sends raw bytes (not JSON),
and we need to skip any auth middleware.
"""

from fastapi import APIRouter, Request, HTTPException

from api.services.stripe_service import handle_webhook_event

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/stripe")
async def stripe_webhook(request: Request):
    """
    Stripe sends webhook events here. We verify the signature and process.
    This endpoint has NO auth — Stripe can't send our session cookie.
    Security is via the webhook signature (STRIPE_WEBHOOK_SECRET).
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        result = handle_webhook_event(payload, sig_header)
        return {"received": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")
    except Exception as e:
        import traceback
        print(f"[stripe-webhook] Error processing event: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Webhook processing failed: {str(e)}")
