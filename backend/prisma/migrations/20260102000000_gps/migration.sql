-- CreateEnum
CREATE TYPE "GpsDeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GpsEventType" AS ENUM ('GEOFENCE_ENTER', 'GEOFENCE_EXIT', 'OVERSPEED', 'HARSH_BRAKING', 'IDLE', 'DEVICE_OFFLINE', 'SIGNAL_RESTORED', 'IGNITION_ON', 'IGNITION_OFF');

-- CreateTable
CREATE TABLE "Geofence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ZONE',
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusM" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Geofence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsDevice" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'DEMO_SIMULATOR',
    "status" "GpsDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "simNumber" TEXT,
    "installedAt" TIMESTAMP(3),
    "lastPingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GpsDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleLocation" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "deviceId" TEXT,
    "tripId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heading" DOUBLE PRECISION,
    "ignition" BOOLEAN NOT NULL DEFAULT true,
    "accuracyM" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'DEMO_SIMULATOR',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsEvent" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "deviceId" TEXT,
    "tripId" TEXT,
    "geofenceId" TEXT,
    "type" "GpsEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speedKph" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'DEMO_SIMULATOR',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Geofence_name_key" ON "Geofence"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_imei_key" ON "GpsDevice"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "GpsDevice_vehicleId_key" ON "GpsDevice"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleLocation_vehicleId_recordedAt_idx" ON "VehicleLocation"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "VehicleLocation_tripId_recordedAt_idx" ON "VehicleLocation"("tripId", "recordedAt");

-- CreateIndex
CREATE INDEX "VehicleLocation_recordedAt_idx" ON "VehicleLocation"("recordedAt");

-- CreateIndex
CREATE INDEX "GpsEvent_vehicleId_occurredAt_idx" ON "GpsEvent"("vehicleId", "occurredAt");

-- CreateIndex
CREATE INDEX "GpsEvent_type_idx" ON "GpsEvent"("type");

-- CreateIndex
CREATE INDEX "GpsEvent_occurredAt_idx" ON "GpsEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "GpsDevice" ADD CONSTRAINT "GpsDevice_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleLocation" ADD CONSTRAINT "VehicleLocation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleLocation" ADD CONSTRAINT "VehicleLocation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "GpsDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleLocation" ADD CONSTRAINT "VehicleLocation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsEvent" ADD CONSTRAINT "GpsEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsEvent" ADD CONSTRAINT "GpsEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "GpsDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsEvent" ADD CONSTRAINT "GpsEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsEvent" ADD CONSTRAINT "GpsEvent_geofenceId_fkey" FOREIGN KEY ("geofenceId") REFERENCES "Geofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
