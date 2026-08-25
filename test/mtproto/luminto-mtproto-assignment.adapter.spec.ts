import { parseLumintoHtml } from '../../src/mtproto/luminto-mtproto-assignment.adapter';

describe('Luminto MTProto flow', () => {
  it('parses and deduplicates proxy links with source ping', () => {
    const html = '445 ms <a href="tg://proxy?server=proxy.example.com&port=443&secret=' +
      '0123456789abcdef0123456789abcdef">proxy</a>' +
      '<a href="tg://proxy?server=proxy.example.com&port=443&secret=' +
      '0123456789abcdef0123456789abcdef">duplicate</a>';
    expect(parseLumintoHtml(html)).toEqual([
      {
        host: 'proxy.example.com',
        port: 443,
        secret: '0123456789abcdef0123456789abcdef',
        pingMs: 445,
      },
    ]);
  });

  it('rejects malformed proxy credentials', () => {
    expect(parseLumintoHtml('href="tg://proxy?server=bad/host&port=443&secret=short"')).toEqual([]);
  });
});
