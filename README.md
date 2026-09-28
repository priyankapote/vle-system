# Aditi Enterprises — Cylinder Tracking System (v4.1)

A local system for tracking cylinders, customers, orders, payments, bills, deliveries and refills.

## 1. Setup (Windows, Mac or Linux)
Requires [Node.js](https://nodejs.org) 18+.

```
cd vle-system
npm install
```
Create your settings file:
- Windows (Command Prompt): `copy .env.example .env`
- Mac / Linux: `cp .env.example .env`

Edit `.env`: set `JWT_SECRET` and the three invite codes (`ADMIN_INVITE_CODE`, `STAFF_INVITE_CODE`, `DELIVERY_INVITE_CODE`). Customer signup needs no code.

```
npm start
```
Open **http://localhost:4000**. First admin: Log in → Admin tab → Sign up with your `ADMIN_INVITE_CODE`.

**Upgrading from v3?** Copy your old `data` folder and `.env` into the new folder, run `npm install`, then `npm start`. Your data is converted automatically (old orders get a line list; finished pickups become "Dropped"). To start completely fresh, delete `data/db.json`.

**Logins are per browser tab.** You can be a customer in one tab and a delivery person in another at the same time. Closing a tab signs you out of it.

## 2. Who can do what

| Action | Admin | Staff | Delivery | Customer |
|---|---|---|---|---|
| Edit business name, deposit %, business/bill details | ✅ | — | — | — |
| Add cylinder types, set/edit prices | ✅ | — | — | — |
| Add cylinders (of existing types) | ✅ | ✅ | — | — |
| Edit / delete cylinders, customers, accounts | ✅ | — | — | own profile |
| Place an order (with deposit) | ✅ auto-approved | ✅ auto-approved | — | ✅ (needs approval) |
| Accept / reject an order request | ✅ | ✅ | — | — |
| Assign delivery / pickup | ✅ | ✅ | — | — |
| Send empty cylinders for refilling | ✅ | ✅ | — | — |
| Mark a cylinder empty | ✅ | ❌ | — | ✅ (own) |
| Pick up / deliver / collect / drop / bring refills back | ✅ | — | ✅ (own jobs) | — |
| View a bill and download the PDF | ✅ | ✅ | — | ✅ (own) |
| Change bill amounts | ✅ | — | — | — |

## 3. Ordering and payment
1. Prices are per cylinder type (presets: Oxygen Small Rs. 1,000 · Oxygen Jumbo Rs. 2,000 · CO2 Small Rs. 1,500 · CO2 Jumbo Rs. 3,000). Admin edits them in **Settings**.
2. **One order can contain several cylinder types** ("+ Add another cylinder type"). Each line shows how many are available right now.
3. The total and the **minimum payable amount** (default 25%, admin-editable 0–100%) are shown. The **Total Deposit Made** box is **filled in with the minimum automatically**; it can be edited to any amount between the minimum and the total ("Use minimum" resets it).
4. **Not enough stock?** If any line asks for more than is available, the order is **rejected immediately** with a message such as "Order rejected due to unavailability of cylinders: Oxygen Small — requested 5, only 3 available". It appears in the customer's history.
5. Otherwise it becomes a **Request**. Admin and staff are notified with the deposit and can **Accept** or **Reject** (from the notification or the dashboard). Rejecting needs a written reason, which the customer sees. Accepting checks stock again.
6. **Accepting reserves the cylinders immediately:** "Available" goes down and "Reserved for accepted orders" goes up right away, before any delivery is assigned.
7. On delivery, the delivery person sees the **balance to collect** and can only mark it delivered after confirming they saw proof of payment.
8. Each accepted order has a **Bill** button (view, then Download PDF). Only admin can edit the amounts.
Orders placed by admin/staff on a customer's behalf are approved immediately (or refused with the same stock message).

## 4. What each person sees for a cylinder (history is history)
- **Customer:** Order Placed → Delivery Assigned → On the Way → In Use → Empty - Ready to Be Collected → **Returned**. Each cylinder has its own row. It becomes **Returned** the moment the delivery person collects it, moves to order history, and never changes again. The customer never sees refilling. While a cylinder is On the Way they see the **delivery person's** photo, name and phone; once a pickup is arranged they see the **pickup person's** the same way (Copy / Call).
- **Delivery person:** sees only their own jobs.
  - Delivery: Available → In Transit → **Delivered**.
  - Pickup: Ready to Collect → **Collected** (from the customer) → **Dropped at Store**. The job is only finished, and the person only becomes free, once they drop the cylinders at the store.
  - Refill run: Refilling → **Delivered** (back in the store).
- **Admin/Staff (physical stock):** In Stock → In Transit → In Use → Empty - Ready to Be Collected → **Returning to Store** (with the delivery person) → **Ready to Refill** (dropped at the store) → **Refilling** (only after a delivery person is assigned) → In Stock.
  An order stays open for staff, showing "Collected — returning to store", until the drop. Then it moves to order history. Cylinders can only be sent for refilling after they have been dropped at the store.

Delivery people are **Available** by default; **Off Duty** is chosen manually; **On Delivery** is automatic and locks the buttons until the job is done.

## 5. Dashboards and notifications
- Overview cards: Available in stock, Reserved for accepted orders, Out, Ready to refill, Refilling, awaiting assignment, requests to approve.
- **View details** on each cylinder type shows a full status breakdown.
- **Cylinders → Ready to refill:** tick some or all dropped empties (or by type), choose an available delivery person, assign.
- Filters on Orders (customer, type, status, date range, this week/month), Cylinders, Customers, Staff.
- **Notifications** (bell): only relevant people are notified. Delivery people are notified **only** when they are assigned a delivery, pickup or refill run — never when orders are placed.
- **Live updates:** every few seconds the app checks for new notifications. When one arrives it shows a message and reloads the overview page by itself, so a new assignment (or an accepted order) appears without pressing refresh.

## 6. Notes
- Passwords are hashed and never shown (admins can reset them).
- Built for trusted local use. For access beyond your network you'd want a real database and HTTPS.

## 7. Putting it online for testing (Render.com, free)
Render deploys from a GitHub repository:
1. Put these files in a **private** GitHub repository (`package.json` and `server.js` must be at the top level, not inside another folder).
2. On Render: New + → Web Service → pick the repository. Build command `npm install`, start command `npm start`, instance type **Free**. Health check path `/api/health`.
3. Add environment variables: `JWT_SECRET`, `ADMIN_INVITE_CODE`, `STAFF_INVITE_CODE`, `DELIVERY_INVITE_CODE`. Optional: `SEED_DEMO=true` and `DEMO_PASSWORD=<strong password>` to recreate demo accounts (phones 9000000001–9000000004) and sample cylinders whenever the data resets.
4. Free plan limits: the service sleeps after about 15 minutes with no visitors (the next visit takes up to a minute), and **its files are wiped when it restarts, sleeps or redeploys** — so orders, users and photos disappear. That is fine for testing but not for real use. For real use, use a paid instance with a persistent disk, or a small server (VPS).
