import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

export interface TelemetryOptions {
  enabled: boolean;
  serviceName: string;
  otlpEndpoint?: string;
}

export async function startTelemetry(options: TelemetryOptions): Promise<void> {
  if (!options.enabled) return;

  if (options.otlpEndpoint) {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = options.otlpEndpoint;
  }

  sdk = new NodeSDK({
    serviceName: options.serviceName,
    instrumentations: [getNodeAutoInstrumentations()],
  });
  await sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
