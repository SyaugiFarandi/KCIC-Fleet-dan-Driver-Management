# Feature Gap Analysis — Enterprise Upgrade

Legend: ✅ done · 🟡 partial (works, needs extension) · ❌ missing

## A. GPS Tracking
| Item | Status | Notes / gap |
| --- | --- | --- |
| Live Fleet Map | ✅ | Leaflet + OSM, DEMO banner |
| Vehicle position | ✅ | Simulator, SSE positions stream |
| Status LIVE/STALE/OFFLINE/SIMULATED | 🟡 | moving/stopped/offline counters exist; explicit STALE vs OFFLINE and SIMULATED tag per vehicle needs surfacing in API/UI |
| Trip history / replay | ✅ | History + replay with playback |
| Geofence | ✅ | CRUD + simulator events |
| GPS device health | 🟡 | device CRUD exists; no health view (last seen, offline duration, signal) |
| GPS events & alerts | ✅ | Types, filter, acknowledge, audit |
| Demo simulator | ✅ | 15 s interval, tagged DEMO_SIMULATOR |

## B. Fleet Intelligence / BI
| Item | Status | Gap |
| --- | --- | --- |
| Executive dashboard | 🟡 | role dashboards exist; no cost/fuel/BI layer |
| Fleet utilization | ✅ | In reports |
| Trip performance | ❌ | on-time %, duration vs estimate |
| Cost overview / cost per km | 🟡 | maintenance cost only; no fuel → blocked on Fuel |
| Vehicle performance | 🟡 | trips/km/maintenance per vehicle in reports |
| Driver performance | ❌ | no driver KPI table |
| Fuel analytics | ❌ | requires Fuel module |
| Maintenance analytics | 🟡 | list + cost; no trend/forecast |
| Vendor performance | ❌ | requires SLA module |
| KPI library | ❌ | formulas undocumented in-app |
| BI dashboard builder | ❌ | no user-configurable widgets |
| Data quality monitor | ❌ | no checks surface |

## C. Predictive Maintenance
| Item | Status | Gap |
| --- | --- | --- |
| Maintenance dashboard | 🟡 | lifecycle table only |
| Preventive schedule | 🟡 | dates exist on vehicles/maintenance; no next-due engine |
| Predictive maintenance | ❌ | km/time-based forecast missing |
| Work orders / repair requests | 🟡 | Maintenance rows cover planned→completed; no request intake fields |
| Defect & breakdown | ❌ | requires Defect model |
| Maintenance history / cost | ✅ | per vehicle in reports |
| Release inspection | ❌ | requires Inspection model |

## D. Digital Inspection
| Item | Status | Gap |
| --- | --- | --- |
| Templates | 🟡 | per-vehicle checklist template JSONB (max 20) |
| Pre/post trip inspection | 🟡 | pre-trip checklist gate on trips only |
| Inspection results | ❌ | no stored inspection runs |
| Defect reports | ❌ | missing |
| Photo evidence | ❌ | no attachment path (adapter placeholder planned) |
| Analytics | ❌ | missing |
| Critical failure blocks assignment | ❌ | must add policy check in dispatch |

## E. Fuel Management
All ❌: transactions, payment method, price reference, consumption, efficiency, anomaly review, reports.

## F. Driver Mobile App / PWA
| Item | Status | Gap |
| --- | --- | --- |
| PWA shell | ✅ | manifest, SW, offline page |
| Driver home / assignments | 🟡 | Trips page is shared; no driver-focused home |
| Accept/decline, pickup, status | 🟡 | API supports transitions; UI generic |
| Inspection / incident / breakdown / fuel submission | ❌ | depends on D/E |
| Offline queue & sync status | ❌ | missing (SW never caches API) |
| Documents / history | 🟡 | trips history exists; driver docs in master data |

## G. Route Optimization
| Item | Status | Gap |
| --- | --- | --- |
| Route master | ✅ | CRUD |
| Planning / estimation | ❌ | no distance/duration estimate |
| Optimization recommendation | ❌ | no recommendation (dispatcher decides) |
| Pickup/drop-off points | ❌ | only free-text origin/destination |
| Restrictions / geofence mgmt | 🟡 | geofences exist; no route restrictions |

## H. Emergency Transport
All ❌ (no priority, no emergency workflow, no reporting).

## I. AI Fleet Assistant
❌. Plan: rule-based, read-only assistant over real DB data, RBAC-scoped; no LLM/keys, no actions.

## J. Vendor SLA
| Item | Status | Gap |
| --- | --- | --- |
| Registry / fleet / drivers | ✅ | vendor CRUD + relations |
| Contracts | ❌ | missing |
| SLA definitions / evidence | ❌ | missing |
| Scorecard / exceptions | ❌ | missing |
| Expiry alerts | ❌ | missing |

## Menu structure
Current sidebar: Dashboard, Booking, Perjalanan, GPS, Kendaraan, Driver, Vendor, Rute,
Maintenance, Laporan, Audit, Pengguna, Notifikasi, Profil.

Missing enterprise menus: Vehicle Inspection, Fuel, Fleet Intelligence, Assistant, and the
Operations/Intelligence/Governance grouping. Dispatch Center maps to existing Trips (keep,
do not duplicate). Executive Dashboard maps to the role dashboard (extend). Master Data
groups Vendor/Route/Users.

## Backend / RBAC / UX gaps
- Transactions exist for dispatch; concurrency guard uses re-check inside transaction — verify
  advisory locking under load before claiming concurrency control (currently application-level
  overlap checks only).
- No defect-based assignment block.
- No SLA/contract permission set (`vendors:sla`), no fuel/inspection permissions.
- Data scoping limited to SELF/ALL; no DEPARTMENT/LOCATION/VENDOR scopes yet.
- Detail views use modals; enterprise asks page or drawer — keep modals for demo, add drawers
  only where rows exceed modal usability (fuel, inspections).
- No E2E suite (Playwright); browser QA is manual.

## Honest constraints
- No real GPS hardware, fuel cards, contract values, or external AI API. All such data is
  synthetic and labeled DEMO; adapters stay configuration-only until credentials exist.
- Predictive maintenance is rule-based (time/km), not ML, per master prompt.
