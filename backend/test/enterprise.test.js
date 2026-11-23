import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, bearer, tokenFor, makeBooking, approveBooking, assignTrip, futureIso } from './helpers.js';

const state = {};

test('route recommendations rank master routes and stay staff-only', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const forbidden = await request(app)
    .get('/api/routes/recommendations?origin=Stasiun%20Halim&destination=Kantor%20Pusat')
    .set(bearer(employee));
  assert.equal(forbidden.status, 403);

  const res = await request(app)
    .get('/api/routes/recommendations?origin=Stasiun%20Halim&destination=Kantor%20Pusat&passengers=3')
    .set(bearer(fleet));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.candidates));
  assert.ok(res.body.candidates.length >= 2);
  assert.equal(res.body.candidates[0].rank, 1);
  assert.ok(res.body.rules.scoring.includes('Skor'));
  assert.ok(res.body.candidates[0].warnings !== undefined);

  const missing = await request(app).get('/api/routes/recommendations?bookingId=tidak_ada').set(bearer(fleet));
  assert.equal(missing.status, 404);
});

test('emergency transport is scoped per requester and decided by approvers', async () => {
  const employee = await tokenFor('employee@demo.local');
  const employee2 = await tokenFor('employee2@demo.local');
  const fleet = await tokenFor('fleet@demo.local');
  const driver = await tokenFor('driver@demo.local');

  const created = await request(app)
    .post('/api/emergency/requests')
    .set(bearer(employee))
    .send({
      purpose: 'QA mobilisasi darurat',
      reason: 'Pengujian otomatis jalur transport darurat',
      passengerCount: 2,
      origin: 'Stasiun Halim',
      destination: 'Stasiun Karawang',
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.priority, 'EMERGENCY');
  assert.equal(created.body.status, 'PENDING');
  state.emergencyId = created.body.id;

  const invalidReason = await request(app)
    .post('/api/emergency/requests')
    .set(bearer(employee))
    .send({ purpose: 'QA gagal', reason: 'pendek', passengerCount: 1, origin: 'Stasiun Halim', destination: 'Kantor Pusat' });
  assert.equal(invalidReason.status, 400);

  const ownList = await request(app).get('/api/emergency').set(bearer(employee));
  assert.equal(ownList.status, 200);
  assert.ok(ownList.body.items.some((item) => item.id === state.emergencyId));

  const otherList = await request(app).get('/api/emergency').set(bearer(employee2));
  assert.equal(otherList.status, 200);
  assert.ok(!otherList.body.items.some((item) => item.id === state.emergencyId), 'requester scope must hide other requests');

  const staffList = await request(app).get('/api/emergency').set(bearer(fleet));
  assert.ok(staffList.body.items.some((item) => item.id === state.emergencyId));

  const driverDecision = await request(app)
    .patch(`/api/emergency/${state.emergencyId}/decision`)
    .set(bearer(driver))
    .send({ decision: 'APPROVED' });
  assert.equal(driverDecision.status, 403);

  const decided = await request(app)
    .patch(`/api/emergency/${state.emergencyId}/decision`)
    .set(bearer(fleet))
    .send({ decision: 'APPROVED' });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.equal(decided.body.status, 'APPROVED');

  const summary = await request(app).get('/api/emergency/summary').set(bearer(fleet));
  assert.equal(summary.status, 200);
  assert.ok(summary.body.counts.APPROVED >= 1);
  assert.ok(summary.body.demoNote.includes('DEMO'));
});

test('inspection completion turns failed items into defects', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const forbidden = await request(app)
    .post('/api/inspections/templates')
    .set(bearer(employee))
    .send({ name: 'QA template terlarang', items: [{ key: 'qa', label: 'QA item' }] });
  assert.equal(forbidden.status, 403);

  const template = await request(app)
    .post('/api/inspections/templates')
    .set(bearer(fleet))
    .send({
      name: 'QA Template Pra-Perjalanan',
      category: 'PRE_TRIP',
      items: [
        { key: 'qa_tires', label: 'Kondisi ban', critical: true },
        { key: 'qa_lights', label: 'Lampu utama', critical: false },
      ],
    });
  assert.equal(template.status, 201, JSON.stringify(template.body));

  const inspection = await request(app)
    .post('/api/inspections')
    .set(bearer(fleet))
    .send({ vehicleId: 'veh_t4', type: 'PRE_TRIP', templateId: template.body.id });
  assert.equal(inspection.status, 201, JSON.stringify(inspection.body));
  assert.equal(inspection.body.status, 'DRAFT');
  assert.equal(inspection.body.items.length, 2);

  const checked = await request(app)
    .patch(`/api/inspections/${inspection.body.id}/items`)
    .set(bearer(fleet))
    .send({ items: [{ key: 'qa_lights', checked: true }, { key: 'qa_tires', checked: false, note: 'Ban aus (QA)' }] });
  assert.equal(checked.status, 200);

  const completed = await request(app)
    .patch(`/api/inspections/${inspection.body.id}/complete`)
    .set(bearer(fleet))
    .send({ odometerKm: 88000 });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'FAILED');
  assert.equal(completed.body.defects.length, 1);
  assert.equal(completed.body.defects[0].severity, 'CRITICAL');
  state.defectId = completed.body.defects[0].id;

  const defectList = await request(app).get('/api/defects?vehicleId=veh_t4').set(bearer(fleet));
  assert.equal(defectList.status, 200);
  assert.ok(defectList.body.items.some((defect) => defect.id === state.defectId));
});

test('maintenance work order from defect resolves it and predictions stay rule-based', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const predictions = await request(app).get('/api/maintenance/predictions').set(bearer(fleet));
  assert.equal(predictions.status, 200);
  assert.ok(Array.isArray(predictions.body.items));
  assert.equal(predictions.body.rules.length, 4);
  assert.ok(['OVERDUE', 'DUE_SOON', 'UNKNOWN', 'OK'].includes(predictions.body.items[0].status));

  const forbidden = await request(app).get('/api/maintenance/predictions').set(bearer(employee));
  assert.equal(forbidden.status, 403);

  const workOrder = await request(app)
    .post('/api/maintenance')
    .set(bearer(fleet))
    .send({ vehicleId: 'veh_t4', title: 'Ganti ban kritis (QA)', scheduledAt: futureIso(24), cost: 150000, defectId: state.defectId });
  assert.equal(workOrder.status, 201, JSON.stringify(workOrder.body));
  assert.equal(workOrder.body.kind, 'CORRECTIVE');
  assert.equal(workOrder.body.priority, 'URGENT');
  assert.equal(workOrder.body.defects[0].status, 'IN_REPAIR');

  const started = await request(app).patch(`/api/maintenance/${workOrder.body.id}/start`).set(bearer(fleet));
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'IN_PROGRESS');

  const completed = await request(app)
    .patch(`/api/maintenance/${workOrder.body.id}/complete`)
    .set(bearer(fleet))
    .send({ cost: 175000 });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'COMPLETED');
  assert.equal(completed.body.defects[0].status, 'RESOLVED');
});

test('driver fuel submission is trip-scoped, anomaly-flagged, and reviewed by staff', async () => {
  const admin = await tokenFor('admin@demo.local');
  const fleet = await tokenFor('fleet@demo.local');
  const dispatcher = await tokenFor('dispatch@demo.local');
  const employee = await tokenFor('employee@demo.local');

  const qaUser = await request(app)
    .post('/api/users')
    .set(bearer(admin))
    .send({ name: 'QA Driver Enterprise', email: 'qa-driver-enterprise@demo.local', password: 'Demo123!', role: 'DRIVER', department: 'QA' });
  assert.equal(qaUser.status, 201, JSON.stringify(qaUser.body));
  const qaDriverToken = await tokenFor('qa-driver-enterprise@demo.local');

  const qaVehicle = await request(app)
    .post('/api/vehicles')
    .set(bearer(fleet))
    .send({ plateNumber: 'QA-9001', brand: 'Toyota', model: 'Innova QA', category: 'MPV', capacity: 8, ownership: 'KCIC', odometerKm: 50000 });
  assert.equal(qaVehicle.status, 201, JSON.stringify(qaVehicle.body));

  const qaDriver = await request(app)
    .post('/api/drivers')
    .set(bearer(fleet))
    .send({
      name: 'QA Driver Enterprise',
      phone: '0812-9999-001',
      licenseNumber: 'SIM-QA-001',
      licenseExpiry: '2031-01-01',
      type: 'INTERNAL',
      userId: qaUser.body.id,
    });
  assert.equal(qaDriver.status, 201, JSON.stringify(qaDriver.body));

  const booking = await makeBooking(employee, { departureAt: futureIso(96), passengerCount: 2 });
  assert.equal(booking.status, 201);
  assert.equal((await approveBooking(fleet, booking.body.id)).status, 200);

  const trip = await assignTrip(dispatcher, booking.body.id, qaVehicle.body.id, qaDriver.body.id);
  assert.equal(trip.status, 201, JSON.stringify(trip.body));

  const accepted = await request(app).patch(`/api/trips/${trip.body.id}/status`).set(bearer(qaDriverToken)).send({ status: 'DRIVER_ACCEPTED' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  // Replaying the same transition models a duplicated offline queue action.
  const replay = await request(app).patch(`/api/trips/${trip.body.id}/status`).set(bearer(qaDriverToken)).send({ status: 'DRIVER_ACCEPTED' });
  assert.equal(replay.status, 409);

  const defect = await request(app)
    .post('/api/defects')
    .set(bearer(qaDriverToken))
    .send({ tripId: trip.body.id, title: 'Kaca spion retak (QA)', severity: 'HIGH' });
  assert.equal(defect.status, 201, JSON.stringify(defect.body));
  assert.equal(defect.body.vehicleId, qaVehicle.body.id);

  const forbiddenFuel = await request(app)
    .post('/api/fuel')
    .set(bearer(employee))
    .send({ vehicleId: qaVehicle.body.id, fuelType: 'BIOSOLAR', liters: 10, pricePerLiter: 6800 });
  assert.equal(forbiddenFuel.status, 403);

  const fuel = await request(app)
    .post('/api/fuel')
    .set(bearer(qaDriverToken))
    .send({ tripId: trip.body.id, fuelType: 'BIOSOLAR', liters: 120, pricePerLiter: 6800, station: 'SPBU DEMO QA' });
  assert.equal(fuel.status, 201, JSON.stringify(fuel.body));
  assert.equal(fuel.body.anomalyStatus, 'FLAGGED');
  assert.equal(fuel.body.vehicleId, qaVehicle.body.id);
  assert.equal(fuel.body.driverId, qaDriver.body.id);

  const driverReview = await request(app).patch(`/api/fuel/${fuel.body.id}/review`).set(bearer(qaDriverToken)).send({ decision: 'APPROVE' });
  assert.equal(driverReview.status, 403);

  const review = await request(app)
    .patch(`/api/fuel/${fuel.body.id}/review`)
    .set(bearer(fleet))
    .send({ decision: 'APPROVE', note: 'Volume diuji QA' });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.anomalyStatus, 'APPROVED');
  assert.ok(review.body.reviewedAt);
});

test('vendor SLA contracts expose definitions and computed scorecard', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  assert.equal((await request(app).get('/api/sla/overview').set(bearer(employee))).status, 403);

  const contract = await request(app)
    .post('/api/sla/contracts')
    .set(bearer(fleet))
    .send({
      vendorId: 'test_vendor_1',
      contractNumber: 'QA-SLA-001',
      serviceScope: 'QA armada vendor',
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: futureIso(24 * 90),
      monthlyValue: 10000000,
      definitions: [
        { metric: 'TRIP_COMPLETION', target: 95 },
        { metric: 'RESPONSE_TIME', target: 30, unit: 'menit' },
      ],
    });
  assert.equal(contract.status, 201, JSON.stringify(contract.body));
  assert.equal(contract.body.slaDefinitions.length, 2);

  const duplicate = await request(app)
    .post('/api/sla/contracts')
    .set(bearer(fleet))
    .send({
      vendorId: 'test_vendor_1',
      contractNumber: 'QA-SLA-001',
      startDate: new Date().toISOString(),
      endDate: futureIso(24 * 60),
    });
  assert.equal(duplicate.status, 409);

  const badRange = await request(app)
    .post('/api/sla/contracts')
    .set(bearer(fleet))
    .send({
      vendorId: 'test_vendor_1',
      contractNumber: 'QA-SLA-002',
      startDate: futureIso(240),
      endDate: futureIso(24),
    });
  assert.equal(badRange.status, 400);

  const overview = await request(app).get('/api/sla/overview').set(bearer(fleet));
  assert.equal(overview.status, 200);
  const evaluated = overview.body.contracts.find((item) => item.contractNumber === 'QA-SLA-001');
  assert.ok(evaluated, 'created contract must appear in the scorecard');
  assert.equal(evaluated.metrics.length, 2);
  assert.ok(overview.body.rules.length >= 4);
});

test('intelligence KPIs, data quality, and widget preferences enforce RBAC', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  assert.equal((await request(app).get('/api/intelligence/kpis').set(bearer(employee))).status, 403);

  const kpis = await request(app).get('/api/intelligence/kpis').set(bearer(fleet));
  assert.equal(kpis.status, 200);
  const groups = Object.keys(kpis.body.groups);
  assert.deepEqual(groups.sort(), ['compliance', 'cost', 'fleet', 'operations']);
  const all = Object.values(kpis.body.groups).flat();
  assert.equal(all.length, 14);
  for (const kpi of all) {
    assert.ok(kpi.formula, `${kpi.id} must document its formula`);
    assert.ok(['GOOD', 'WARN', 'BAD', 'NEUTRAL'].includes(kpi.status));
  }
  assert.ok(kpis.body.disclaimer.includes('DEMO'));

  const quality = await request(app).get('/api/intelligence/data-quality').set(bearer(fleet));
  assert.equal(quality.status, 200);
  assert.equal(quality.body.checks.length, 12);
  assert.equal(typeof quality.body.score, 'number');
  assert.ok(Array.isArray(quality.body.failing));

  const saved = await request(app)
    .put('/api/intelligence/widgets')
    .set(bearer(fleet))
    .send({ widgets: ['fleet_utilization', 'trip_completion_rate'] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.widgets, ['fleet_utilization', 'trip_completion_rate']);

  const persisted = await request(app).get('/api/intelligence/kpis').set(bearer(fleet));
  assert.deepEqual(persisted.body.preferences.widgets, ['fleet_utilization', 'trip_completion_rate']);

  const unknown = await request(app)
    .put('/api/intelligence/widgets')
    .set(bearer(fleet))
    .send({ widgets: ['bukan_widget'] });
  assert.equal(unknown.status, 400);
});

test('fleet assistant answers are rule-based, read-only, and staff-only', async () => {
  const fleet = await tokenFor('fleet@demo.local');
  const employee = await tokenFor('employee@demo.local');

  assert.equal((await request(app).get('/api/assistant/suggestions').set(bearer(employee))).status, 403);

  const suggestions = await request(app).get('/api/assistant/suggestions').set(bearer(fleet));
  assert.equal(suggestions.status, 200);
  assert.ok(suggestions.body.suggestions.length >= 8);

  const answer = await request(app)
    .post('/api/assistant/query')
    .set(bearer(fleet))
    .send({ question: 'Ada defect kritis yang terbuka?' });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.engine, 'RULE_BASED');
  assert.equal(answer.body.readOnly, true);
  assert.equal(answer.body.intent, 'inspection');
  assert.ok(answer.body.answer.length > 0);
  assert.ok(Array.isArray(answer.body.bullets));
  assert.ok(answer.body.disclaimer.includes('rule-based'));

  const shortQuestion = await request(app).post('/api/assistant/query').set(bearer(fleet)).send({ question: 'ab' });
  assert.equal(shortQuestion.status, 400);

  const forbidden = await request(app).post('/api/assistant/query').set(bearer(employee)).send({ question: 'Ringkasan armada?' });
  assert.equal(forbidden.status, 403);
});
