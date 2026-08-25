import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { OrderRecord } from '../orders/order.types';
import type {
  PaymentRepository,
  PaymentResult,
  SuccessfulStarsPayment,
} from './payment.types';

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async markStarsPaymentPaid(
    input: SuccessfulStarsPayment,
  ): Promise<PaymentResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { telegramInvoicePayload: input.invoicePayload },
          });
          if (!order) throw new Error('ORDER_NOT_FOUND');
          if (order.customerId !== input.customerId)
            throw new Error('ORDER_OWNERSHIP_MISMATCH');
          if (order.currency !== 'XTR' || input.currency !== 'XTR')
            throw new Error('PAYMENT_CURRENCY_MISMATCH');
          if (order.amountXtr !== input.totalAmount)
            throw new Error('PAYMENT_AMOUNT_MISMATCH');
          if (order.status === 'PAID' || order.status === 'FULFILLED') {
            const payment = await tx.payment.findUnique({
              where: { orderId: order.id },
            });
            if (payment?.providerPaymentId === input.telegramPaymentChargeId)
              return { kind: 'DUPLICATE', order: order as OrderRecord };
            throw new Error('ORDER_ALREADY_PAID');
          }
          if (order.status !== 'PENDING_PAYMENT')
            throw new Error('ORDER_NOT_PAYABLE');
          await tx.payment.create({
            data: {
              orderId: order.id,
              provider: 'TELEGRAM_STARS',
              providerPaymentId: input.telegramPaymentChargeId,
              providerEventId: null,
              amountXtr: input.totalAmount,
              currency: 'XTR',
              status: 'SUCCEEDED',
              referenceMetadata: { source: 'successful_payment' },
            },
          });
          const updated = await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'PAID',
              telegramPaymentChargeId: input.telegramPaymentChargeId,
              paidAt: new Date(),
              pendingCheckoutKey: null,
            },
          });
          return { kind: 'PAID', order: updated as OrderRecord };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        const order = await this.prisma.order.findUnique({
          where: { telegramInvoicePayload: input.invoicePayload },
          include: { payment: true },
        });
        if (
          order &&
          (order.status === 'PAID' || order.status === 'FULFILLED') &&
          order.payment?.providerPaymentId === input.telegramPaymentChargeId
        )
          return { kind: 'DUPLICATE', order: order as OrderRecord };
      }
      throw error;
    }
  }
}
