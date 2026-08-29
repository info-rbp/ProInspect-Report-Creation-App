export const expectedDevelopmentName = /\bdevelopment\b/i;

export function assertDevelopmentTarget(input, confirmation) {
  const projectId = input.projectId?.trim();
  const projectName = input.projectName?.trim();
  const endpoint = input.endpoint?.trim();
  if (!projectId || projectId === 'DEVELOPMENT_PROJECT_ID_REQUIRED') throw new Error('A real Development APPWRITE_PROJECT_ID is required.');
  if (!projectName || !expectedDevelopmentName.test(projectName)) throw new Error('The live Appwrite project name must clearly contain Development.');
  if (!endpoint?.startsWith('https://')) throw new Error('APPWRITE_ENDPOINT must use HTTPS.');
  if (confirmation !== 'push-development' && confirmation !== 'seed-development' && confirmation !== 'clear-development-seed' && confirmation !== 'verify-development' && confirmation !== 'test-development') {
    throw new Error('An explicit Development confirmation value is required.');
  }
  return { projectId, projectName, endpoint };
}
