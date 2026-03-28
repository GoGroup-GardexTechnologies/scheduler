import axios from 'axios';
import { WebhookService } from '../services/WebhookService';
import { WebhookConfig } from '../config';

jest.mock('axios');
jest.mock('../config', () => ({
  config: {
    schedulerSecret: 'test-scheduler-secret',
    webhooks: [],
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const baseWebhook: WebhookConfig = {
  id: 'track-examination-expiry',
  type: 'track-examination-expiry',
  url: 'http://localhost:8888/api/cron/trackExaminationExpiry',
  intervalSeconds: 300,
  enabled: true,
};

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService();
    mockedAxios.post = jest.fn().mockResolvedValue({ status: 200 });
  });

  it('sends x-scheduler-secret header with the configured secret', async () => {
    await service.sendWebhookRequest(baseWebhook);

    const [, , axiosConfig] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(axiosConfig.headers['x-scheduler-secret']).toBe('test-scheduler-secret');
  });

  it('does not send an Authorization header', async () => {
    await service.sendWebhookRequest(baseWebhook);

    const [, , axiosConfig] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(axiosConfig.headers['authorization']).toBeUndefined();
    expect(axiosConfig.headers['Authorization']).toBeUndefined();
  });

  it('sends { nonce: true } as the payload for every webhook type', async () => {
    await service.sendWebhookRequest(baseWebhook);

    const [, payload] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(payload).toEqual({ nonce: true });
  });

  it('uses the default 5 000 ms timeout when no timeoutMs is set', async () => {
    await service.sendWebhookRequest(baseWebhook);

    const [, , axiosConfig] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(axiosConfig.timeout).toBe(5000);
  });

  it('uses the per-webhook timeoutMs when provided', async () => {
    const webhook: WebhookConfig = { ...baseWebhook, timeoutMs: 300000 };
    await service.sendWebhookRequest(webhook);

    const [, , axiosConfig] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(axiosConfig.timeout).toBe(300000);
  });

  it('calls the correct URL', async () => {
    await service.sendWebhookRequest(baseWebhook);

    const [url] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(url).toBe('http://localhost:8888/api/cron/trackExaminationExpiry');
  });

  it('re-throws on HTTP error so the coordinator can handle it', async () => {
    mockedAxios.post = jest.fn().mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true, response: { status: 503 } })
    );
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(service.sendWebhookRequest(baseWebhook)).rejects.toThrow('connect ECONNREFUSED');
  });

  it('merges per-webhook custom headers, overriding defaults', async () => {
    const webhook: WebhookConfig = {
      ...baseWebhook,
      headers: { 'x-custom': 'value', 'x-scheduler-secret': 'override' },
    };
    await service.sendWebhookRequest(webhook);

    const [, , axiosConfig] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(axiosConfig.headers['x-custom']).toBe('value');
    expect(axiosConfig.headers['x-scheduler-secret']).toBe('override');
  });
});
