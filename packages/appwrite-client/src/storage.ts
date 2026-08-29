import { Permission, Role, type Storage } from 'appwrite';

export function evidenceFilePermissions(ownerUserId: string, permittedTeamIds: string[] = []): string[] {
  return [
    Permission.read(Role.user(ownerUserId)),
    ...permittedTeamIds.map((teamId) => Permission.read(Role.team(teamId))),
  ];
}

export function downloadEvidence(storage: Storage, bucketId: string, fileId: string): string {
  return storage.getFileDownload({ bucketId, fileId });
}
