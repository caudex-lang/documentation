## Caudex Standard Recommendation 7 (CSR-7)

## Official Documentation and Markdown Style Guide

| Field         | Value                             |
| :------------ | :-------------------------------- |
| **Version**   | 1.0.1                             |
| **Author(s)** | Madeleine                         |
| **Date**      | 9 September 2026                  |
| **Status**    | Draft                             |

### 1 - Introduction

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

### 2 - Document Structure

#### 2.1 - Title (Mandatory)

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

#### 2.2 - Metadata Header (Mandatory)

Immediately following the title, a metadata header is required. This block
provides essential information about the document and is presented as a
Markdown table.

**Format:**

```markdown
| Field         | Value                                   |
| :------------ | :-------------------------------------- |
| **Version**   | [X.Y.Z]                                 |
| **Author(s)** | [Author Name(s)]                        |
| **Date**      | [Date]                                  |
| **Status**    | [In Development/Draft/Approved/...]     |
```

**Example:**

```markdown
| Field         | Value                        |
| :------------ | :--------------------------- |
| **Version**   | 1.5.4                        |
| **Author(s)** | Madeleine                    |
| **Date**      | 30 July 2025                 |
| **Status**    | Approved                     |
```

##### 2.2.1 - Document status

The document can be in various state of publication:

*   **In Development**: The document is being written
*   **Under Review**: The document is being reviewed before publication
*   **Draft**: The document has been published and is open for comments
*   **Approved**: The document has been published and is frozen
*   **Retired**: The document is not going to be updated anymore but is
    still in use for now.
*   **Archived**: The document is being archived and not relevant to the
    project anymore.

#### 2.3 - Headings

Use a logical heading hierarchy, starting with `###` for the main sections and
increasing the number of `#` for sub-sections. Do not skip heading levels.
Place a blank line before and after each heading.

Use number to clearly label each section, never have a trailing dot after the
number and separate the section number from the title by using a dash (`-`).
The section number reference its parent section like section 1 subsection 2
would be written `1.2`.

```markdown
### 1 - Top Level Heading

...

#### 1.1 - Subsection

...

##### 1.1.1 - Sub-subsection

...
```

#### 2.4 - Tables

Tables should be used for presenting structured data, such as keywords, naming
conventions, or data formats. Use simple Markdown table syntax with pipes
(`|`) and hyphens (`-`).

*   **Column Alignment:**
    *   Left-align: `| :--- |` (pipe, space, semi-colon, dashes, space, pipe)
    *   Center-align: `| :---: |` (pipe, space, semi-colon, dashes, semi-color,
        space, pipe)
    *   Right-align: `| ---: |` (pipe, space, dashes, semi-colon, space, pipe)

Try, in text format, to keep tables columns align as much as possible. It is not
always possible and as markdown do not allow new line in a cell a cell content
can get  really long, the rule is to do as best as possible while keeping the
table readable in text format.

*Tables can go beyond the recommended document width.*

```markdown
| Keywords    |           |             |
| :---------- | :-------- | :---------- |
| alignof     | any       | as          |
| base        | bitsof    | bits        |
```

### 3 - Markdown Formatting

#### 3.1 - Text Styling

*   **Bold:** Use double asterisks (`**bold**`) for emphasis on important
    terms or phrases.
*   **Italic:** Use single asterisks (`*italic*`) for foreign terms, variable
    names in prose, or for less strong emphasis.
*   **Inline Code:** Use a single backtick (`` `inline code` ``) for all
    code-related elements within a sentence. This includes keywords, type
    names, function names, filenames, and short code snippets.

#### 3.2 - Code Blocks

Always use a fenced code block with the language specified after the opening
fence (`` ``` ``) to enable syntax highlighting. Use `caudex` for Caudex code,
`c` for C, and `cpp` for C++, `peg` for PEG code.

#### 3.3 - Lists

*   **Bulleted Lists:** Use an asterisk (`*`) followed by three spaces.
*   **Numbered Lists:** Use a number followed by a period and followed by two
    spaces.
*   **Sub-lists:** Indent sub-lists with **4 spaces**.
*   When a line need to wrap make sure the next line allign with content
    on the first line

Example:

```markdown

*   Bullet 1
*   Bullet 2
    *   Sub bullet 1
    *   Sub bullet 2
    *   Sub bullet 3 too long to fit on a line
        and need to span on multiple lines

...

1.  Point 1
2.  Point 2
    1.  Sub point 2

```

### 4 - General Recommendations

*   **Line Length:** Limit all lines of text to a maximum of **80 characters**
    to improve readability on various screen sizes.
*   **File Naming:** Use `Pascal Case` with a `CSR-XX` prefix for naming
    document files and space between words (e.g., `CSR-07 - Markdown Style Guide.md`).
    *Note*: Filename use two digit with a zero 0 prefix to help sorting the documents.
    The number itself in the document do not need any 0 padding.
*   **Cross-referencing:** When referencing another document, use its full
    title and the `CSR-X` identifier. For example: "As defined in `CSR-1`,
    the Caudex language specification..."
