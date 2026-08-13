## Caudex Standard Recommendation 7 (CSR-7)

## Official Documentation and Markdown Style Guide

| Field         | Value                             |
| :------------ | :-------------------------------- |
| **Version**   | 1.0.0                             |
| **Author(s)** | Madeleine                         |
| **Date**      | 13 August 2026                    |
| **Status**    | Draft                             |

### 1. Introduction

This document formalizes the Markdown style guide for all official Caudex
documentation. Its purpose is to ensure that all project documentation is
consistent, readable, and professional. Adherence to this guide is mandatory
for all new and updated documents within the Caudex ecosystem, including
Standard Recommendations (CSRs), specification documents, and tutorials.

The core principles of this guide are:

*   **Consistency:** Use the same formatting for similar elements across all
    documents.
*   **Clarity:** The structure should be easy to follow and the content should
    be highly readable.
*   **Maintainability:** The formatting should be simple to write and edit.

### 2. Document Structure

#### 2.1 Title (Mandatory)

Every official document **must** begin with a two-line title using level-2
headings.

**Format:**

```markdown
## Caudex Standard Recommendation X (CSR-X)

## [Document Name]
```

**Example:**

```markdown
## Caudex Standard Recommendation 1 (CSR-1)

## Caudex Language Specification
```

#### 2.2 Metadata Header (Mandatory)

Immediately following the title, a metadata header is required. This block
provides essential information about the document and is presented as a
Markdown table.

**Format:**

```markdown
| Field         | Value                             |
| :------------ | :-------------------------------- |
| **Version**   | [X.Y.Z]                           |
| **Author(s)** | [Author Name(s)]                  |
| **Date**      | [Date]                            |
| **Status**    | [Draft/In Progress/Final/Retired] |
```

**Example:**

```markdown
| Field         | Value                        |
| :------------ | :--------------------------- |
| **Version**   | 1.5.4                        |
| **Author(s)** | Madeleine                    |
| **Date**      | 30 July 2025                 |
| **Status**    | Final                        |
```

#### 2.3 Headings

Use a logical heading hierarchy, starting with `###` for the main sections and
increasing the number of `#` for sub-sections. Do not skip heading levels.
Place a blank line before and after each heading.

```markdown
### Section 1: Top Level Heading

...

#### 1.1: Subsection

...

##### 1.1.1: Sub-subsection

...
```

#### 2.4 Tables

Tables should be used for presenting structured data, such as keywords, naming
conventions, or data formats. Use simple Markdown table syntax with pipes
(`|`) and hyphens (`-`).

*   **Column Alignment:**
    *   Left-align: `| :--- |`
    *   Center-align: `| :---: |`
    *   Right-align: `| ---: |`

```markdown
| Keywords    |           |             |
| :---------- | :-------- | :---------- |
| alignof     | any       | as          |
| base        | bitsof    | bits        |
```

#### 2.5 Document history

The last section of the document shall be a table showing a succint history of
the document changes, formated like in this exemple:

```
### Document History

| Version | Date           | Author(s)  | Changes         |
| :------ | :------------- | :--------- | :-------------- |
| 1.0.0   | 20 August 2026 | Madeleine  | Initial version |
```

### 3. Markdown Formatting

#### 3.1 Text Styling

*   **Bold:** Use double asterisks (`**bold**`) for emphasis on important
    terms or phrases.
*   **Italic:** Use single asterisks (`*italic*`) for foreign terms, variable
    names in prose, or for less strong emphasis.
*   **Inline Code:** Use a single backtick (`` `inline code` ``) for all
    code-related elements within a sentence. This includes keywords, type
    names, function names, filenames, and short code snippets.

#### 3.2 Code Blocks

Always use a fenced code block with the language specified after the opening
fence (`` ``` ``) to enable syntax highlighting. Use `caudex` for Caudex code,
`c` for C, and `cpp` for C++, `peg` for PEG code.

#### 3.3 Lists

*   **Bulleted Lists:** Use an asterisk (`*`) followed by a space.
*   **Numbered Lists:** Use a number followed by a period and a space.
*   **Sub-lists:** Indent sub-lists with **4 spaces**.

### 4. General Recommendations

*   **Line Length:** Limit all lines of text to a maximum of **80 characters**
    to improve readability on various screen sizes.
*   **File Naming:** Use `Pascal Case` with a `CSR-XX` prefix for naming
    document files and space between words (e.g., `CSR-07 - Markdown Style Guide.md`).
    _Note_: Filename use two digit with a zero 0 prefix to help sorting the documents. 
    The number itself in the document do not need any 0 padding.
*   **Cross-referencing:** When referencing another document, use its full
    title and the `CSR-X` identifier. For example: "As defined in `CSR-1`,
    the Caudex language specification..."

### Document History

| Version | Date           | Author(s)  | Changes         |
| :------ | :------------- | :--------- | :-------------- |
| 1.0.0   | 20 August 2026 | Madeleine  | Initial version |
