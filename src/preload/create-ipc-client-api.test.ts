import { testContract } from '@shared/ipc/testing/test-contract';
import { describe, expect, it, vi } from 'vitest';
import { createIpcClientApi } from './create-ipc-client-api';

describe('createIpcClientApi', () => {
  it('createIpcClientApi_WhenActionIsCalled_InvokesDerivedChannelAndReturnsResult', async () => {
    // Arrange
    const invoke = vi.fn(() => Promise.resolve({ message: 'Hallo Argus' }));
    const api = createIpcClientApi(testContract, invoke);

    // Act
    const response = await api.greeting.greet({ name: 'Argus' });

    // Assert
    expect(invoke).toHaveBeenCalledWith('greeting:greet', { name: 'Argus' });
    expect(response).toEqual({ message: 'Hallo Argus' });
  });
});
