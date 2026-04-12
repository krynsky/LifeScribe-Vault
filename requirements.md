LifeScribe Vault Requirements



Create an app that runs on my local computer that allows me to aggregate personal data from multiple data sources that could be local documents or connectors to third party data sources to build out a comprehensive personal data repository in an Obsidian vault comprised of markdown files and image assets that could be used for several purposes with the primary being a data store that could be used to provide any information about a person's life and can be queried against the data or help push the data to other services.



The app should use the following Github project for storage into a dedicated Obsidian valult: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f



Local document uploads:

Ability to upload multiple different document types such as PDF, XLS, TXT, MD and many more that can then be analyzed and then have the data extracted and stored in a structured way with metadata enrichment in an Obsidican vault.



Creating connectors to third party services to import data:

In addition to uploading local documents to populate the vault a user may have third party web services that contain their personal data. The ability to connect to those web services to pull all the data via API should be an option. If that's difficult or not free to do via API there should be a way to do manual exports of the data to files that can be stored locally that could then be imported into the vault. The app should create a library of all possible services a user may want to do this with with details and coneectors for each one.



Some possible resources for third party data connectors:

https://github.com/public-apis/public-apis

https://scrapecreators.com/



Ability to publish data from the vault to third party services:

One of the features I want to add is the ability to take all the rich data that is stored in the vault and allow this data to be published other services. The initial use case for this will be to create entries into the various sections of the lifescribe.us application. Provide the best method for achieving this. If we need to build an MCP for both this app and lifescribe.us as a method to do this provide that recommendation. Keep in mind we may add other services to publish data to in the future.



Another feature would be to simple allow an llm to chat with the data in the vault.



So the app should be comprised a dashboard that is the main interface used for uploading the documents or maintaining the web connectors along with a log of all the data that has been uploaded to the vault.



I want you to research and find any and all free open source libraries on github that can be used to provide all the desired functionality explained so far as well as recommend other features and functionality that would supplement what has been defined so far.



