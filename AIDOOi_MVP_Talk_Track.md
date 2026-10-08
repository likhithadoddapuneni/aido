# AIDOOi MVP — talk track

The same script is in the speaker notes of `AIDOOi_MVP_Client_Presentation.pptx`
(View → Notes Page, or the Notes pane in Presenter View). This file is for rehearsing
and for printing.

**Total runtime: about 5 minutes of talking, plus a 5-minute live demo in the middle.**
The demo is the centre of the meeting — the slides exist to frame it and to close it.

**Before you start:** have the MVP already running at `http://localhost:8777`, on the
recommendations page, in a second window. Do not make them watch you start a server.

---

## Slide 1 — Tell us the room. We will furnish it properly.

OPENING — about 60 seconds.

"Thank you for the 52 documents. I read all of them — the Master Plan, the eight core workflows and all 47 standards — and then I did the thing they were written for: I built it.

Everything you are about to see is running software, not a mock-up. What is on screen behind me is the AIDOOi MVP, served from my laptop, and I will drive it live in a moment.

The one-line version of AIDOOi, which is the version I would use with an investor: a customer tells us the room — the real dimensions, the style they like, the budget they have — and AIDOOi returns complete, coordinated furnishing options built only from products that are genuinely in stock. The customer can go and sit on the sofa before they buy it, and then pay for everything from every showroom in a single transaction.

Two numbers to anchor the scale: six hundred and one verified products, eight hundred and fifty-one live seller offers, across six partner showrooms. And all of it governed by your forty-seven standards."

[Pause. Move to slide 2.]

---

## Slide 2 — “MVP” means a working product, not a deck

SCOPE — about 75 seconds. This is the slide that answers the question someone in the room is already thinking.

"Before the demo, I want to settle one thing, because it is the question I was asked and I suspect it is the question in this room: when the documents say 'MVP', do they mean a presentation, a design, or a product?

They mean a product. And that is not my opinion — it is your own documents.

Section seven of the Master Plan is titled 'Development Modules and Handoff', and the column heading is literally 'Developer Deliverable'. It names a frontend web app, a product data service, a recommendation service, a viewing service, a commerce service and settlement.

Section eight is an eight-phase build sequence that starts with a database and entity model, IDs, taxonomy and authentication. You cannot deliver that in slides.

And section nine, the acceptance gates, are all runtime behaviours. 'No capture before all required seller validations.' 'Master order splits correctly with locked transaction snapshots.' Those are state transitions. The only way to pass them is to run code.

So the deliverable is the product. A deck like this one is a wrapper around it — useful for five minutes, which is roughly how long I plan to spend here before I open the app.

On the right: the eight core workflows from your own document. All eight are built and working end to end, with zero console errors on a full click-through."

[Move to slide 3 and get ready to switch to the live app.]

---

## Slide 3 — Four options, scored by your standards

DEMO — about 2 minutes on this slide, then SWITCH TO THE LIVE APP.

"This is the heart of the product, so I want to be precise about it.

AID-LOG-009 scores each individual product against the customer: fit at thirty percent, style at twenty-five, colour fifteen, budget fifteen, practical ten, availability five. Those are your weights, not mine — I implemented them exactly.

AID-LOG-010 then scores whole compositions, because a recommendation is a coordinated room, not a pile of individually good products.

And here is the part I want you to hold on to, because it is what makes AIDOOi different from a filter on a furniture site: there is a quality floor. A product scoring below sixty never enters a composition — not even to fill an empty slot. A composition below seventy is never shown. If the inventory cannot support four good options, the system shows three and tells the customer why. It does not pad.

I will show you that live in a second, because on a Luxury budget the system actually refuses to build a Premium Choice and says so — there is no meaningful upgrade available, so it does not invent one. That behaviour is straight out of AID-LOG-010 section seven, and most teams would have quietly faked a fourth card."

[SWITCH TO THE LIVE APP NOW. Five-minute demo path:
 1. Find my best match → Living Room
 2. 5.5 × 4.5 — point out: 24.8 square metres, classification Medium, derived by the system, never chosen by the customer
 3. Scandinavian, Beige, Standard — point out the representative product image on each budget card
 4. Generate → four options, four different anchor sofas
 5. Open Best Overall → the measured plan, drawn to scale from verified dimensions
 6. Click the sofa on the plan → the Product Card with the full score breakdown
 7. Replace it → only eligible alternatives, revalidated before it applies
 8. Request viewing → deposit, five percent capped at five hundred dirhams, QR pass
 9. Checkout → one payment, split into seller orders with locked snapshots
10. Orders → advance a line to Receipt Confirmed, watch settlement flip to Eligible

Then return to slide 4.]

---

## Slide 4 — Where we are, and what I need from you

CLOSE — about 90 seconds.

"So where does that leave us.

On the left: what works today. All eight customer paths end to end. The real scoring logic, not a sketch of it. Viewing with the capped deposit and the attribution trail. One checkout that splits into seller orders with locked price and commission snapshots, and a settlement run that only pays out on receipt-confirmed lines.

In the middle: what comes next, in the order I would do it. Schema and catalogue ingestion first, because nothing is testable until real AID and AIO records exist — and I want to flag that standardising partner catalogues to AID-DATA-001 through 014 is a data-quality project with a human owner, not a form. Then the recommendation engine as a service. Then payments. Then the admin back office.

On the right, the part I actually need from you today. Three decisions.

One: the style and colour compatibility maps. AID-LOG-009 section twelve says they must be controlled maps maintained by AIDOOi — but no map was supplied. I have written a first draft and it is working, but it drives forty percent of every product score, so it needs your sign-off and a review cadence.

Two: the villa budget rule. AID-LOG-008 deliberately publishes no table because villa budget follows composition, not floors. I implemented exactly that — I sum the actual room modules. I need you to confirm that is the production rule.

Three, and this is the interesting one: AID-LOG-009 has no craftsmanship or build-quality factor. Fit, style, colour, budget, practical, availability — that is the whole score. So when a lower-tier product matches perfectly, the engine correctly leaves money unspent. You will see the app say 'one thousand three hundred and seventy dirhams of your budget is unspent' and explain why. That is standards-correct, and it may also not be what you want commercially. If quality should influence ranking, LOG-009 needs a new factor, and that is your call, not mine.

And along the bottom: I found fourteen places where the standards are silent, ambiguous or contradict each other. You only find those by executing the rules, not by reading them. AID-VIS-001 is referenced twice but does not exist. LOG-001 points studio and villa budgets at LOG-003, which is bedroom logic. 'Available placement space' is required for fit and never defined. All fourteen are written up with the decision I took and why.

That is the build. Happy to take questions, or go back into the app and break it in whatever way you like."

[End. Offer the laptop.]

---

## If you only have 90 seconds

"You gave me 52 documents and 47 standards. I read them and then I built what they
describe — a working AI furnishing assistant, running today. A customer gives us the room
dimensions, style and budget; AIDOOi returns four complete, coordinated options built only
from products that are actually in stock, each one scored against your own AID-LOG-009
weights. They can view the products physically, pay a capped deposit, and buy from five
showrooms in one transaction. All eight of your core workflows work end to end. Let me show
you — and then I have three decisions I need from you."

## Likely questions, and honest answers

**"Is this a prototype or the real thing?"**
It is the real decision logic on a demo catalogue. The scoring, the thresholds, the deposit
arithmetic, the order splitting and the settlement rules are production-correct. What is not
production is the infrastructure: no database, no payment provider, no admin back office.
Those are Phases 1, 6 and 7 of your own build sequence.

**"Where did the products come from?"**
They are generated from your AID-LOG-001 price bands so the demo is stable and repeatable.
Every record follows the AIP/AID/AIO architecture from AID-DATA-005, so real partner
catalogues drop into the same shape.

**"Why does it leave budget unspent?"**
Because AID-LOG-009 has no quality factor. Fit, style, colour, budget, practical and
availability are the whole score — so when a lower-tier product matches perfectly, it wins.
The app says so out loud rather than hiding it. If you want price to pull rank, that is a
change to LOG-009, and it is your call.

**"How long to production?"**
I will not give you a number without the catalogue. Catalogue standardisation to
AID-DATA-001 through 014 is the critical path and it is a data-quality project, not a
sprint. Give me the real partner data and the three decisions on slide 4 and I will phase it
properly.