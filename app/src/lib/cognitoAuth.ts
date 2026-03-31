import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js'

const USER_POOL_ID = (import.meta as any).env?.VITE_COGNITO_USER_POOL_ID || ''
const CLIENT_ID = (import.meta as any).env?.VITE_COGNITO_CLIENT_ID || ''

export const cognitoConfigOk = Boolean(USER_POOL_ID && CLIENT_ID)

let userPool: CognitoUserPool | null = null

function getPool(): CognitoUserPool {
  if (!userPool) {
    if (!cognitoConfigOk) throw new Error('Cognito not configured (VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID)')
    userPool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
  }
  return userPool
}

export interface AppUser {
  id: string
  email: string
}

function sessionToUser(session: CognitoUserSession, cognitoUser: CognitoUser): AppUser {
  const payload = session.getIdToken().decodePayload()
  return {
    id: payload.sub as string,
    email: (payload.email as string) || cognitoUser.getUsername(),
  }
}

export function getCurrentSession(): Promise<{ session: CognitoUserSession; user: AppUser } | null> {
  return new Promise((resolve) => {
    try {
      const pool = getPool()
      const cognitoUser = pool.getCurrentUser()
      if (!cognitoUser) return resolve(null)

      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) return resolve(null)
        resolve({ session, user: sessionToUser(session, cognitoUser) })
      })
    } catch {
      resolve(null)
    }
  })
}

export function getIdToken(): Promise<string> {
  return getCurrentSession().then((s) => s?.session.getIdToken().getJwtToken() || '')
}

export function signUp(email: string, password: string): Promise<AppUser> {
  return new Promise((resolve, reject) => {
    const pool = getPool()
    const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })]
    pool.signUp(email, password, attrs, [], (err, result) => {
      if (err) return reject(err)
      if (!result?.user) return reject(new Error('Sign up failed'))
      resolve({ id: result.userSub, email })
    })
  })
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getPool()
    const user = new CognitoUser({ Username: email, Pool: pool })
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

export function signIn(email: string, password: string): Promise<AppUser> {
  return new Promise((resolve, reject) => {
    const pool = getPool()
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve(sessionToUser(session, cognitoUser))
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(new Error('Password change required. Please contact support.'))
      },
    })
  })
}

export function signOut(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const pool = getPool()
      const user = pool.getCurrentUser()
      if (user) user.signOut()
    } catch {
      // best effort
    }
    resolve()
  })
}

export function resendConfirmation(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getPool()
    const user = new CognitoUser({ Username: email, Pool: pool })
    user.resendConfirmationCode((err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}
