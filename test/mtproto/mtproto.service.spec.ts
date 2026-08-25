import { MtprotoService } from '../../src/mtproto/mtproto.service';
import { MtprotoAssignmentError } from '../../src/mtproto/mtproto-assignment.port';

describe('MtprotoService', () => {
  it('passes only the server-resolved customer id for get and rotation', async () => {
    const assignment = { proxyUrl: 'tg://proxy?secret=owner', latencyMs: 10 };
    const port = {
      getCurrentAssignment: jest.fn().mockResolvedValue(assignment),
      rotateAssignment: jest.fn().mockResolvedValue(assignment),
      getShareLink: jest.fn().mockResolvedValue(assignment.proxyUrl),
      checkAssignment: jest.fn().mockResolvedValue(assignment),
    };
    const service = new MtprotoService(port);
    await expect(service.getOwn(42)).resolves.toEqual(assignment);
    await expect(service.rotateOwn(42)).resolves.toEqual(assignment);
    expect(port.getCurrentAssignment).toHaveBeenCalledWith(42);
    expect(port.rotateAssignment).toHaveBeenCalledWith(42);
  });

  it('returns null when no assignment exists', async () => {
    const service = new MtprotoService({
      getCurrentAssignment: jest.fn().mockResolvedValue(null),
      rotateAssignment: jest.fn().mockResolvedValue(null),
      getShareLink: jest.fn().mockResolvedValue(null),
      checkAssignment: jest.fn().mockResolvedValue(null),
    });
    await expect(service.getOwn(42)).resolves.toBeNull();
  });

  it('allows proxy rotation only once per five minutes per user', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00Z'));
    const assignment = { proxyUrl: 'tg://proxy?secret=owner', latencyMs: 10 };
    const port = {
      getCurrentAssignment: jest.fn(),
      rotateAssignment: jest.fn().mockResolvedValue(assignment),
      getShareLink: jest.fn(),
      checkAssignment: jest.fn(),
    };
    const service = new MtprotoService(port);

    await expect(service.rotateOwn(42)).resolves.toEqual(assignment);
    await expect(service.rotateOwn(42)).rejects.toEqual(
      new MtprotoAssignmentError('RATE_LIMITED'),
    );
    await expect(service.rotateOwn(43)).resolves.toEqual(assignment);
    jest.advanceTimersByTime(5 * 60 * 1000);
    await expect(service.rotateOwn(42)).resolves.toEqual(assignment);
    expect(port.rotateAssignment).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  it('does not start the cooldown when proxy rotation fails', async () => {
    const port = {
      getCurrentAssignment: jest.fn(),
      rotateAssignment: jest
        .fn()
        .mockRejectedValueOnce(new Error('unavailable'))
        .mockResolvedValueOnce(null),
      getShareLink: jest.fn(),
      checkAssignment: jest.fn(),
    };
    const service = new MtprotoService(port);
    await expect(service.rotateOwn(42)).rejects.toThrow('unavailable');
    await expect(service.rotateOwn(42)).resolves.toBeNull();
    expect(port.rotateAssignment).toHaveBeenCalledTimes(2);
  });
});
