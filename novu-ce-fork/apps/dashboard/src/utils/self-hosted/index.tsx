import { IOrganizationEntity } from '@novu/shared';
import React from 'react';
import { AuthContextProvider, useAuth } from './auth.resource';
import {
  OrganizationList,
  OrganizationProfile,
  RedirectToSignIn,
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  UserProfile,
} from './components';
import { getJwtToken, isJwtValid } from './jwt-manager';
import { OrganizationSwitcher } from './organization-switcher';
import { OrganizationContextProvider, useOrganization } from './organization.resource';
import { UserButton } from './user-button';
import { UserContextProvider, useUser } from './user.resource';

export {
  AuthContextProvider, OrganizationContextProvider, OrganizationList,
  OrganizationProfile, OrganizationSwitcher, RedirectToSignIn,
  SignedIn,
  SignedOut, SignIn,
  SignUp, UserButton, UserProfile
};

  export { useAuth, useOrganization, useUser };

export const useClerk = () => {
  return {
    setActive: async () => {
      console.warn('Clerk.setActive is not available in self-hosted mode');
    },
  };
};

export const useOrganizationList = () => {
  const { organization, isLoaded } = useOrganization() as {
    organization: IOrganizationEntity;
    isLoaded: boolean;
  };

  return {
    isLoaded,
    organizationList: organization ? [organization] : [],
    setActive: async () => null,
  };
};

export const ClerkContext = React.createContext({});

export type ProtectProps = {
  children: React.ReactNode;
  [key: string]: any;
};

export const Protect = ({ children, ...rest }: ProtectProps) => {
  return children;
};

export function ClerkProvider({ children }: any) {
  const value = {};

  return (
    <ClerkContext.Provider value={value}>
      <UserContextProvider>
        <AuthContextProvider>
          <OrganizationContextProvider>{children}</OrganizationContextProvider>
        </AuthContextProvider>
      </UserContextProvider>
    </ClerkContext.Provider>
  );
}

/**
 * TPE patch (2026-05-02): upstream prod set `loggedIn` to a static value
 * captured once at module-load time. After login the value stayed false
 * until full page reload — this caused login loops because SignedOut /
 * RedirectToSignIn checks Clerk.loggedIn directly.
 *
 * Fix: use a getter so `Clerk.loggedIn` ALWAYS reads fresh from
 * localStorage. After login.handleSubmit stores the JWT, the next read
 * returns true automatically — no need to manually mutate the property.
 */
const clerkObj: any = {
  session: {
    getToken: () => getJwtToken(),
  },
};
Object.defineProperty(clerkObj, 'loggedIn', {
  get: () => isJwtValid(getJwtToken()),
  configurable: true,
  enumerable: true,
});
(window as any).Clerk = clerkObj;

export type DecodedJwt = {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  organizationId: string;
  environmentId: string | null;
  roles: string[];
  iat: number;
  exp: number;
  iss: string;
};
