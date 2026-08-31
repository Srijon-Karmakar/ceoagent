# Office Local Setup

This setup runs one CEO Agent OS server on an office machine and lets other
office machines use it from a browser at:

```text
http://ceoagent.office:3100
```

## 1. Choose The Server Machine

Use one reliable machine that stays on during office hours. Find its LAN IP:

```powershell
ipconfig
```

Look for the active adapter's IPv4 address, for example:

```text
192.168.1.50
```

## 2. Configure CEO Agent OS

On the server machine, `.env` should contain:

```ini
PORT=3100
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

For browser-based OAuth callbacks from other office machines, use the office
hostname:

```ini
GOOGLE_REDIRECT_URI=http://ceoagent.office:3100/auth/gmail/callback
META_REDIRECT_URI=http://ceoagent.office:3100/auth/instagram/callback
LINKEDIN_REDIRECT_URI=http://ceoagent.office:3100/auth/linkedin/callback
```

The same callback URLs must be added exactly in the provider dashboards.
Some providers may reject non-public HTTP hostnames. If that happens, use a
real HTTPS domain or tunnel for those specific integrations.

## 3. Start The Server

Run this on the server machine:

```powershell
npm install
npm run build
npm start
```

Test on the server machine:

```text
http://localhost:3100
```

## 4. Allow The Firewall Port

Run PowerShell as Administrator on the server machine:

```powershell
New-NetFirewallRule -DisplayName "CEO Agent OS 3100" -Direction Inbound -Protocol TCP -LocalPort 3100 -Action Allow
```

## 5. Make ceoagent.office Resolve In The Office

Best option: add a local DNS/router record:

```text
ceoagent.office -> 192.168.1.50
```

Fallback option: edit each employee machine's hosts file as Administrator:

```text
C:\Windows\System32\drivers\etc\hosts
```

Add:

```text
192.168.1.50 ceoagent.office
```

Replace `192.168.1.50` with the real server machine IP.

## 6. Use From Other Machines

On employee machines, open:

```text
http://ceoagent.office:3100
```

Each user signs in with their own Supabase account. The current app creates a
separate workspace for each user.

