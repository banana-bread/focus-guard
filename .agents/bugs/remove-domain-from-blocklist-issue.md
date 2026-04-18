when removing a domain from blocklist, while that domain has a current unlock session active, redirects to an error page

### Expected behaviour
1. unlock domain for 5 mins
2. remove blocked domain permanently from settings with yubikey
3. domain should now be permanently unlocked

### Actual behaviour
1. unlock domain for 5 mins
2. remove blocked domain permanently from settings with yubikey
3. open tab with domain redirects to error page with messages "Your file couldn’t be accessed, It may have been moved, edited, or deleted.ERR_FILE_NOT_FOUND"