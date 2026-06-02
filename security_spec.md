# Security Specification - Medimate Health

## Data Invariants
1. A Patient must have an `ownerId` that matches the creator's UID.
2. Schedules, Vitals, Contacts, and Logs must reference a valid `patientId`.
3. Read access to a patient's data is restricted to the `ownerId` or an `admin`.
4. Only `admins` can see all users and all patients.

## The Dirty Dozen Payloads (Unauthorized Attempts)
1. **Identity Spoofing**: User A attempts to create a Patient with `ownerId: UserB_UID`.
2. **Admin Escalation**: User A attempts to set `role: "admin"` on their own User document.
3. **Cross-Tenant Read**: User A attempts to `get` a Patient document owned by User B.
4. **Orphaned Schedule**: User A attempts to create a Schedule without a `patientId`.
5. **Unauthorized Vital Injection**: User A attempts to write a Vital reading for User B's patient.
6. **Shadow Field Injection**: User A attempts to add `isVerified: true` to their User document.
7. **Role Spoofing**: User A attempts to create a document in the `admins` collection.
8. **PII Leak**: User A attempts to `list` all users to see emails.
9. **State Shortcutting**: User A attempts to update a Schedule status to 'taken' without providing required fields.
10. **Resource Poisoning**: User A attempts to use a 2MB string as a pill name.
11. **Timestamp Manipulation**: User A attempts to set a `timestamp` in the past for a new Vital.
12. **Relationship Poisoning**: User A attempts to delete a Patient they don't own.

## Test Runner (Logic Check)
- `it('should reject non-admin users from reading other users documents')`
- `it('should only allow patients to be read by owner or admin')`
- `it('should enforce strict schema on User creation')`
- `it('should check if patient exists before adding vitals')` (via exists check in rules)
