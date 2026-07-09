Generate {{docFormat}} for the following {{language}} code.
 
You MUST follow the exact structure below. Do not deviate from this format.
 
## Example Output Structure
 
For a method:
```
/**
* Brief description of what the method does.
*
* <p>Additional detail about behaviour, side effects, or constraints (1-2 sentences max).
*
* @param paramName description of the parameter and its expected values
* @param anotherParam description of the parameter
* @return description of the return value and possible states
* @throws ExceptionType when this condition occurs
* @since 1.0
*/
```
 
For a class:
```
/**
* Brief description of what the class is responsible for.
*
* How this class fits into the broader module. Key behavioural notes.
*
* @see RelatedClass
* @since 1.0
*/
```
 
---
 
Follow this structure exactly. Adapt content to the actual code below.
- Document all parameters with @param tags
- Document return value with @return tag
- Document exceptions with @throws tags
- Add @since tag if applicable
- Be concise but informative
- Do not document trivial getters/setters
 
Code to document:
```{{languageLower}}
{{code}}
```