# List of possible improvements

- use a specific NPM library to manage financial calculation as described at Point 4 in app.js
- improve the code documentation
- fix 10 libraries vulnerabilities (7moderate, 3 high) with "npm audit fix": in this way you can upgrade deprecated libraries:
  you can obtain the list as output from "npm install" or you can obtain list of vulnerabilities with "npm audit"
- create eslint configuration file .eslintrc to use ESLint
- use a tool to properly format the code using a uniform style (e.g. Prettier plugin in VSCode)
- split the code into multiple files to better organize the code
- create functions to be used inside express routes
- create unit tests for the functions
- create tests for rest APIs
- try to improve performances using Fastify instead of Express.js
- as reported in Point 6, it can be improved with the same solution of Point 7 using a JOIN.
  In this way the solution is more readable and more performant (it can be verified)