import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  profile: any | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, isAdmin: false, profile: null });

export const useAuth = () => useContext(AuthContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<any | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        setUser(user);
        if (user) {
          // 1. Immediate Hardcoded Admin Check (Fastest)
          const hardcodedAdmins = ['aditya.mishra123546@gmail.com', 'naitikrsg@gmail.com'];
          const isHardcodedAdmin = hardcodedAdmins.includes(user.email || '');
          
          if (isHardcodedAdmin) {
            setIsAdmin(true);
          }

          // 2. Sync user profile
          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);
          
          let currentProfile;
          if (!userSnap.exists()) {
            const newProfile = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || 'User',
              role: isHardcodedAdmin ? 'admin' : 'user'
            };
            try {
              await setDoc(userDocRef, newProfile);
            } catch (e) {
              console.warn("Profile creation failed, continuing...", e);
            }
            currentProfile = newProfile;
          } else {
            currentProfile = userSnap.data();
            if (currentProfile?.role === 'admin') setIsAdmin(true);
          }
          setProfile(currentProfile);

          // 3. Persistent Admin Check
          const adminDocRef = doc(db, 'admins', user.uid);
          const adminSnap = await getDoc(adminDocRef);
          
          if (adminSnap.exists() || isHardcodedAdmin) {
            setIsAdmin(true);
            if (!adminSnap.exists() && isHardcodedAdmin) {
               try {
                 await setDoc(adminDocRef, { email: user.email });
               } catch (e) {
                 console.warn("Admin record creation failed", e);
               }
            }
          }
        } else {
          setProfile(null);
          setIsAdmin(false);
          setUser(null);
        }
      } catch (err) {
        console.error("Auth sync error:", err);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, profile }}>
      {children}
    </AuthContext.Provider>
  );
};
