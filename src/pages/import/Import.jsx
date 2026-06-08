import { useState, useEffect, createRef, Fragment } from "react";
import { useLocation, Redirect } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";

import { Button } from "../../components/button";
import { Header, Main } from "../../components/page";
import { getRandomId } from "../../utils/id";
import { addAtTopOp } from "../../utils/owr-list";
import { useListCommit } from "../../utils/owr-list-commit";

import "./Import.css";

export const Import = ({ isMobile }) => {
  const MainComponent = isMobile ? Main : Fragment;
  const location = useLocation();
  const commit = useListCommit();
  const intl = useIntl();
  const [list, setList] = useState(null);
  const [error, setError] = useState(false);
  const [typeError, setTypeError] = useState(false);
  const [redirect, setRedirect] = useState(null);
  const fileInput = createRef();
  const handleListChange = () => {
    const files = fileInput.current.files;

    if (files.length > 0) {
      if ("application/json" === files[0].type) {
        setTypeError(false);
        setList(files[0]);
      } else {
        setTypeError(true);
      }
    }
  };
  const handleSubmit = (event) => {
    const reader = new FileReader();

    setError(false);
    reader.readAsText(list, "UTF-8");
    reader.onload = (event) => {
      const newId = getRandomId();
      const importedList = JSON.parse(event.target.result);
      commit(addAtTopOp({ ...importedList, id: newId }));
      setRedirect(newId);
    };
    reader.onerror = () => {
      setError(true);
    };

    event.preventDefault();
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      {redirect && <Redirect to={`/editor/${redirect}`} />}

      {isMobile && (
        <Header to="/" headline={intl.formatMessage({ id: "import.title" })} />
      )}

      <MainComponent>
        {!isMobile && (
          <Header
            isSection
            to="/"
            headline={intl.formatMessage({ id: "import.title" })}
          />
        )}
        <form onSubmit={handleSubmit} className="import">
          <label htmlFor="list">
            <FormattedMessage id="import.description" />
          </label>
          <input
            type="file"
            accept=".json, application/json"
            id="list"
            className="input"
            onChange={handleListChange}
            autoComplete="off"
            required
            ref={fileInput}
          />
          {typeError && (
            <p className="export__error">
              <FormattedMessage id="import.typeError" />
            </p>
          )}
          {error && (
            <p className="export__error">
              <FormattedMessage id="export.error" />
            </p>
          )}
          <Button centered icon="add-list" submitButton spaceTop size="large">
            <FormattedMessage id="import.button" />
          </Button>
        </form>
      </MainComponent>
    </>
  );
};
