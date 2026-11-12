# Setup runbook: switching the journal from sample mode to the real backend

Do this together, with the journal's owner present. It uses the owner's own Google account, so the
data lives in a project she controls. Nothing here needs any code knowledge: you click, copy and paste.

The website keeps working in sample mode the whole time. Nothing changes for visitors until the very
last step.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> signed in to the owner's Google account.
2. Add project. Give it any name (for example "journal"). Write the project ID it shows down.
3. When asked about Google Analytics, switch it **off**. The privacy promise is "no analytics, no trackers".

## 2. Turn on email and password sign-in

1. Build > Authentication > Get started.
2. Sign-in method > Email/Password > turn on the first switch (leave "Email link" off) > Save.
3. If there is a setting that lets new people **sign up** by themselves, turn it off. Only the two
   accounts below should ever exist. (If your console version has no such switch, the security rules
   still keep strangers out: anyone not in the member list can read and write nothing.)

## 3. Add the two accounts and copy their IDs

1. Authentication > Users > Add user. Add the first person's real email and a password they will
   remember (they can reset it later from the sign-in screen). Repeat for the second person.
2. Each row now shows a **User UID** (a long string of letters and numbers). Copy both somewhere
   handy. You will paste them in step 5. Note which UID belongs to Hers and which to His.

## 4. Create the database

1. Build > Firestore Database > Create database.
2. Pick the location closest to you.
3. Choose **production mode** (not test mode). Finish.

## 5. Tell the database who the two members are

The app reads one document that only the console can write.

1. In Firestore Data, Start collection. Collection ID: `config`. Document ID: `members`.
2. Add these three fields exactly:
   - `uids`: type **array**, with two **string** items: the two UIDs from step 3.
   - `doors`: type **map**, with two string fields: `hers` = the Hers UID, `his` = the His UID.
   - `names`: type **map**, with two string fields: `hers` = the name to show for her door,
     `his` = the name to show for his door.
3. Save.

## 6. Publish the security rules

1. Firestore Database > Rules.
2. Delete what is there, paste the whole contents of `firestore.rules` from this repository, then press **Publish**.

## 7. Register the web app and copy its settings

1. Project overview > the web icon `</>` > register an app (name it anything; do **not** set up Hosting).
2. Firebase shows a block called `firebaseConfig`. Copy its values.
3. Open `js/firebase-config.js` in this repository and replace each `PLACEHOLDER...` value with the
   matching one (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
   Leave `enabled: false` for now. These values are public by design; they only name the project.

## 8. Allow the website's address

Authentication > Settings > Authorized domains > Add domain: the address of the published site
(for example `yourname.github.io`, without `https://` and without a path).

## 9. Try it safely first (optional but recommended)

Run the site on your own computer and check, before anyone else sees it:

- Her login opens Hers, and His login on the Hers form says "This journal is private."
- A wrong password gives a plain sentence, not a code.
- Signing out and reloading shows no journal text.

## 10. Test the rules (any time the rules change)

The rules tests run automatically in GitHub (the "Firestore rules tests" check) on every push.
To run them on a computer with Node and Java installed:

```
npm install
npm run test:rules
```

They use a throwaway emulator with made-up accounts; they never touch the real project.

## 11. Switch the site over

When everything above is done and the sign-in screen has been connected to real credentials:

1. In `js/firebase-config.js` set `enabled: true`.
2. In `js/config.js` change `MODE` from `'demo'` to `'firebase'`.
3. Run `node scripts/build.mjs`, commit and publish.

The sample banner then goes away and the privacy statement applies: entries are stored on Google's
servers (Firebase), protected by the login, not end-to-end encrypted, visible to whoever owns the
Firebase project in its console, with no analytics and no trackers.

If anything looks wrong, change `MODE` back to `'demo'` and publish: the site returns to sample mode and
no real data is touched.
