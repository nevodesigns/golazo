Output "/home/nwokolo/golazo/demo/segments/free.mp4"
Set Shell bash
Set FontSize 20
Set Width 1920
Set Height 1000
Set Padding 40
Set TypingSpeed 35ms
Sleep 600ms
Type "# The free API: the whole tournament archive, no key, no payment"
Enter
Sleep 1200ms
Type "curl -s localhost:3000/health | jq '{status, dataset}'"
Enter
Sleep 3000ms
Type 'curl -s "localhost:3000/v1/matches?stage=final" | jq ".matches[0] | {homeTeam, awayTeam, homeScore, awayScore, afterExtraTime, venue, goals}"'
Enter
Sleep 4000ms
