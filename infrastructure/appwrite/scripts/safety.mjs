export const expectedDevelopmentName = /\bdevelopment\b/i;
export const expectedDevelopmentProjectId = 'proinspect-development';
export const expectedDevelopmentEndpoint = 'https://syd.cloud.appwrite.io/v1';
export const prohibitedProjectId = '6a911f1e0031e90015b2';

export function assertDevelopmentTarget(input, confirmation) {
  const projectId = input.projectId?.trim();
  const projectName = input.projectName?.trim();
  const endpoint = input.endpoint?.trim();
  if (!projectId || projectId === 'DEVELOPMENT_PROJECT_ID_REQUIRED') throw new Error('A real Development APPWRITE_PROJECT_ID is required.');
  if (projectId === prohibitedProjectId) throw new Error('The prohibited Appwrite project must never be targeted.');
  if (projectId !== expectedDevelopmentProjectId) throw new Error(`APPWRITE_PROJECT_ID must be ${expectedDevelopmentProjectId}.`);
  if (!projectName || !expectedDevelopmentName.test(projectName)) throw new Error('The live Appwrite project name must clearly contain Development.');
  if (endpoint !== expectedDevelopmentEndpoint) throw new Error(`APPWRITE_ENDPOINT must be ${expectedDevelopmentEndpoint}.`);
  if (confirmation !== 'push-development' && confirmation !== 'seed-development' && confirmation !== 'clear-development-seed' && confirmation !== 'verify-development' && confirmation !== 'test-development') {
    throw new Error('An explicit Development confirmation value is required.');
  }
  return { projectId, projectName, endpoint };
}
