import type { Account, Models } from 'appwrite';

export function createEmailPasswordSession(account: Account, email: string, password: string): Promise<Models.Session> {
  return account.createEmailPasswordSession({ email: email.trim(), password });
}

export function requestEmailVerification(account: Account, returnUrl: string): Promise<Models.Token> {
  return account.createVerification({ url: returnUrl });
}

export function requestPasswordRecovery(account: Account, email: string, returnUrl: string): Promise<Models.Token> {
  return account.createRecovery({ email: email.trim(), url: returnUrl });
}

export function currentAccount(account: Account): Promise<Models.User<Models.Preferences>> {
  return account.get();
}
