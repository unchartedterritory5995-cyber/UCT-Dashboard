# Free Tier Access — Design Spec

**Date:** 2026-04-08
**Goal:** Let users sign up and access a limited set of pages without payment, to get the product in front of an audience quickly. Monetization/paywall can be added back later.

## Free Pages (full data, no restrictions)
- Dashboard
- Breadth
- Theme Tracker
- Calendar
- Settings (always accessible)

## Locked Pages (hidden from nav for free users)
Morning Wire, UCT20, Screener, Journal, Watchlists, Options Flow, Dark Pool, Post Market, Model Book, Setup Library, Community, Support, Traders

## Changes

### 1. Signup.jsx
Remove the `startCheckout()` call after successful signup. User signs up → verifies email → lands on Dashboard.

### 2. AuthGuard.jsx
- Add a `FREE_PAGES` whitelist: `/dashboard`, `/breadth`, `/theme-tracker`, `/calendar`, `/settings`
- Free users accessing a whitelisted page: allow through
- Free users accessing any other page: redirect to `/dashboard` (not `/subscribe`)
- Pro users and admins: unchanged (full access)

### 3. Sidebar / Nav Component
- Filter nav items based on `plan` from AuthContext
- Free users only see: Dashboard, Breadth, Theme Tracker, Calendar, Settings
- Pro users and admins see all items

### 4. App.jsx / Routes
- No route changes needed — AuthGuard handles access control
- `/subscribe` page can stay dormant for future use

### 5. Settings Page
- Subscription section shows "Free Plan" for free users
- Upgrade button can remain (wired to Stripe) or be hidden — keep for now

## What doesn't change
- Account creation, email verification, password reset flows
- Backend APIs (no per-endpoint plan gating)
- Live prices and real-time data on free pages
- Admin access
- Existing pro subscribers (full access)
