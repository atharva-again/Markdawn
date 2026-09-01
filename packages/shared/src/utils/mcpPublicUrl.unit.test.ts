import { describe, expect, it } from 'vitest';
import { normalizeMcpPublicOrigin, parseMcpApiUrl, parseMcpPublicUrl } from './mcpPublicUrl';

describe('MCP public URL validation', () => {
  it('allows HTTP only for loopback hostnames', () => {
    expect(parseMcpPublicUrl('http://localhost:3002', false).protocol).toBe('http:');
    expect(parseMcpPublicUrl('http://127.0.0.1:3002', false).protocol).toBe('http:');
    expect(parseMcpPublicUrl('http://[::1]:3002', false).protocol).toBe('http:');
  });

  it('requires HTTPS for non-loopback hostnames', () => {
    expect(() => parseMcpPublicUrl('http://192.168.1.5:3002', false)).toThrow(
      'MCP_PUBLIC_URL must use HTTPS',
    );
    expect(() => parseMcpPublicUrl('http://mcp.example.test:3002', false)).toThrow(
      'MCP_PUBLIC_URL must use HTTPS',
    );
    expect(normalizeMcpPublicOrigin('https://192.168.1.5:3002', false)).toEqual(
      new URL('https://192.168.1.5:3002/'),
    );
  });

  it('allows custom public HTTPS origins in production', () => {
    expect(parseMcpPublicUrl('https://mcp.my-company.example', true)).toEqual(
      new URL('https://mcp.my-company.example/'),
    );
  });

  it('rejects remote plaintext MCP API URLs', () => {
    expect(() => parseMcpApiUrl('http://api.example.test:3001')).toThrow(
      'MCP_API_URL must use HTTPS',
    );
    expect(parseMcpApiUrl('http://127.0.0.1:3001')).toEqual(new URL('http://127.0.0.1:3001/'));
  });
});
