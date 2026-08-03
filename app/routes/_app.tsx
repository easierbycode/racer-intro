import { define } from '../utils.ts'

export default define.page(function App({ Component }) {
  return (
    <html lang='en'>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
        <title>racer control deck</title>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        {/* spelled out: preact types crossorigin as a string union */}
        <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin='anonymous' />
        <link
          href='https://fonts.googleapis.com/css2?family=Orbitron:wght@400..900&display=swap'
          rel='stylesheet'
        />
      </head>
      <body>
        <Component />
      </body>
    </html>
  )
})
