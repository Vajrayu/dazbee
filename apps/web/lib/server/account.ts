// The API's calls for the signed-in person's account, from the web app's server only: what deleting it
// would do, and deleting it.
import 'server-only'

import { z } from 'zod'

import { AccountDeletion, type DeleteAccount } from '@dazbee/schema'

import { call } from './api.ts'

/** The workspaces deleting the account deletes, and those to hand over Owner of first. */
export const getAccountDeletion = () => call(AccountDeletion, '/me/deletion')

/**
 * Deletes the account, confirmed with its email and the workspaces it was shown to delete; refused for another
 * email, while there is Owner to hand over, or when it would delete other workspaces now.
 */
export const deleteAccount = (confirmed: DeleteAccount) => call(z.null(), '/me', { method: 'DELETE', body: confirmed })
