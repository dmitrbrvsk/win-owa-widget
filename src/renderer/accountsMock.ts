import { type AccountsApi } from '../shared/accounts';

export const mockAccountsApi: AccountsApi = {
    addAccount: async () => {
        throw new Error('Exchange accounts require the desktop app');
    },
    renameAccount: async () => {},
    removeAccount: async () => {},
    setPrimaryAccount: async () => {},
    setAccountVisible: async () => {},
    showAllAccounts: async () => {},
    selectAccount: async () => {},
};
