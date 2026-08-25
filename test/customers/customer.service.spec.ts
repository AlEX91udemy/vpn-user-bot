import { CustomerService } from '../../src/customers/customer.service';
import { InMemoryCustomerRepository } from '../helpers/in-memory.repositories';

describe('CustomerService', () => {
  const telegram = { id: 42, username: 'alice', first_name: 'Alice' };

  it('creates a Customer for a new Telegram user', async () => {
    const repo = new InMemoryCustomerRepository();
    const customer = await new CustomerService(repo).getOrCreateFromTelegram(
      telegram,
    );
    expect(customer.telegramUserId).toBe(42n);
    expect(repo.size).toBe(1);
  });

  it('returns the same Customer for the same Telegram user', async () => {
    const service = new CustomerService(new InMemoryCustomerRepository());
    const first = await service.getOrCreateFromTelegram(telegram);
    const second = await service.getOrCreateFromTelegram(telegram);
    expect(second.id).toBe(first.id);
  });

  it('creates one Customer under concurrent registration', async () => {
    const repo = new InMemoryCustomerRepository();
    const service = new CustomerService(repo);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.getOrCreateFromTelegram(telegram),
      ),
    );
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(repo.size).toBe(1);
  });

  it('updates display username without creating another Customer', async () => {
    const repo = new InMemoryCustomerRepository();
    const service = new CustomerService(repo);
    const first = await service.getOrCreateFromTelegram(telegram);
    const updated = await service.getOrCreateFromTelegram({
      ...telegram,
      username: 'alice_new',
    });
    expect(updated.id).toBe(first.id);
    expect(updated.username).toBe('alice_new');
    expect(repo.size).toBe(1);
  });
});
