-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('NOT_CONNECTED', 'PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PREPARING', 'READY', 'COLLECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('VERBAL_STAFF_CONFIRMED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE',
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "reset_token_hash" TEXT,
    "reset_token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_connections" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "waba_id" TEXT,
    "phone_number_id" TEXT,
    "approved_display_name" TEXT,
    "connection_status" "ConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "access_token_encrypted" TEXT,
    "connected_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "display_token" TEXT NOT NULL,
    "customer_phone" TEXT,
    "consent_given" BOOLEAN NOT NULL,
    "consent_captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent_method" "ConsentMethod",
    "status" "OrderStatus" NOT NULL DEFAULT 'PREPARING',
    "ready_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "terminal_at" TIMESTAMP(3),
    "phone_scrubbed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_attempts" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "job_status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "sender_display_name_snapshot" TEXT,
    "template_identifier_snapshot" TEXT,
    "rendered_message_snapshot" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_opt_outs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "opted_out_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_email_key" ON "restaurants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_restaurant_id_key" ON "whatsapp_connections"("restaurant_id");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_status_idx" ON "orders"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_display_token_idx" ON "orders"("restaurant_id", "display_token");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_customer_phone_idx" ON "orders"("restaurant_id", "customer_phone");

-- CreateIndex
CREATE INDEX "orders_status_terminal_at_idx" ON "orders"("status", "terminal_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_attempts_provider_message_id_key" ON "notification_attempts"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_attempts_job_status_idx" ON "notification_attempts"("job_status");

-- CreateIndex
CREATE INDEX "notification_attempts_order_id_idx" ON "notification_attempts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_attempts_order_id_attempt_number_key" ON "notification_attempts"("order_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "notification_opt_outs_restaurant_id_phone_normalized_key" ON "notification_opt_outs"("restaurant_id", "phone_normalized");

CREATE UNIQUE INDEX one_active_attempt_per_order
ON notification_attempts (order_id)
WHERE job_status IN ('PENDING', 'PROCESSING');

-- AddForeignKey
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
