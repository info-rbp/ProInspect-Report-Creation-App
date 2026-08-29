import { Permission, Role } from 'node-appwrite';

export interface ReadScope { userIds?: string[]; teamIds?: string[]; }

export function apiManagedRowPermissions(scope: ReadScope): string[] {
  return [
    ...(scope.userIds ?? []).map((userId) => Permission.read(Role.user(userId))),
    ...(scope.teamIds ?? []).map((teamId) => Permission.read(Role.team(teamId))),
  ];
}

export function assertNoClientWritePermission(permissions: string[]): void {
  const broadWrite = permissions.find((permission) => /^(create|update|delete|write)\(/.test(permission));
  if (broadWrite) throw new Error('Operational rows must not grant client-side write permissions.');
}
